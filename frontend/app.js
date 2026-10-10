import { classifyHealthResponse, createApiClient, getAssumptionsText, probeBackend } from './api.js';

const DEFAULT_API = 'http://127.0.0.1:8000';
const $ = (id) => document.getElementById(id);
const samples = {
  debug: 'def add_numbers(a, b):\n    return a - b\n\nprint(add_numbers(2, 3))',
  trim: 'def get_total(items):\n    total = 0\n    for item in items:\n        total = total + item\n    return total',
  verify: 'def add_numbers(a, b):\n    return a + b',
};
const modeLabels = { debug: 'AI Debugger', trim: 'CodeTrim', verify: 'Code Verifier' };
const state = {
  mode: 'debug', activeRequestMode: null, connectionRequestActive: false,
  results: { debug: null, trim: null, verify: null },
  errors: { debug: null, trim: null, verify: null },
  originals: { debug: '', trim: '' }, trimLanguage: 'python', trimVerification: null, toastTimer: null,
};
const apiRequest = createApiClient({ getBase: () => apiBase() });

function apiBase() {
  const raw = $('apiBase').value.trim() || DEFAULT_API;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Enter a valid backend URL, such as http://127.0.0.1:8000.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The backend URL must start with http:// or https://.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter only the backend origin and optional path, without credentials, query parameters, or fragments.');
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (window.location.protocol === 'https:' && parsed.protocol === 'http:' && !loopback) {
    throw new Error('This HTTPS page cannot call a non-local HTTP API. Use an HTTPS API URL; HTTP is allowed only for localhost/loopback, subject to browser local-network permissions.');
  }
  return raw.replace(/\/+$/, '');
}
async function diagnoseConnectionFailure(error) {
  let base;
  try { base = apiBase(); } catch { return { state: 'offline', title: 'Invalid API URL', message: error.message }; }
  if (!['NETWORK_OR_CORS', 'TIMEOUT'].includes(error.code)) return { state: 'offline', title: 'Request failed', message: error.message };
  const probe = await probeBackend(base, { timeoutMs: 5000 });
  if (probe.state === 'reachable_opaque') {
    return {
      state: 'degraded',
      title: 'Backend responds, but the browser cannot read it',
      message: `Likely CORS: FastAPI responded to a reachability-only check. Set CORS_ORIGINS to include exactly ${window.location.origin}, restart FastAPI, and retry. If the browser asks, also allow this site to access the local network.`,
    };
  }
  return {
    state: 'offline',
    title: 'FastAPI unreachable or browser-blocked',
    message: `No response was confirmed from ${base}. Start FastAPI on the same computer as this browser and verify the URL/port and firewall. If using Chrome or Edge, allow local-network access for ${window.location.origin} if prompted. A denied browser permission can look the same as a stopped server.`,
  };
}
function setConnection(status, message, modelsMessage) {
  const node = $('connection'); node.dataset.state = status;
  node.classList.remove('online', 'offline', 'degraded');
  if (['online', 'offline', 'degraded'].includes(status)) node.classList.add(status);
  node.querySelector('span').textContent = message;
  if (modelsMessage !== undefined) $('modelList').textContent = modelsMessage;
}
function updateRunButton() {
  const busy = state.activeRequestMode !== null;
  $('runAction').disabled = busy; $('verifyAction').disabled = busy;
  const labels = { debug: 'Diagnose code', trim: 'Find simpler code', verify: 'Check syntax' };
  $('runAction').innerHTML = `<span>${busy ? `Working on ${modeLabels[state.activeRequestMode]}…` : labels[state.mode]}</span><span aria-hidden="true">${busy ? '· · ·' : '↗'}</span>`;
}
function setStatus(text, tone = '') {
  $('resultStatus').textContent = text;
  $('resultStatus').className = `result-status${tone ? ` ${tone}` : ''}`;
}
function setMode(mode, focus = false) {
  if (!Object.hasOwn(modeLabels, mode)) return;
  state.mode = mode;
  document.querySelectorAll('.tool-tab').forEach((tab) => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  $('workspace').setAttribute('aria-labelledby', `tab-${mode}`);
  $('resultHeading').textContent = mode === 'debug' ? 'Diagnosis report' : mode === 'trim' ? 'CodeTrim review' : 'Syntax verification';
  $('debugFields').classList.toggle('hidden', mode !== 'debug'); $('trimFields').classList.toggle('hidden', mode !== 'trim');
  $('sourceHeading').textContent = mode === 'verify' ? 'Code to inspect' : 'Your source';
  $('editorNote').textContent = mode === 'debug'
    ? 'Model-generated fixes are suggestions. Review and test them before use.'
    : mode === 'trim'
      ? 'A shorter result is not necessarily clearer or behavior-preserving. Candidates start unverified.'
      : 'Only Python syntax is currently supported by the backend. No code is executed.';
  updateRunButton(); renderResult();
}
function updateLineNumbers() {
  const lines = Math.max(1, $('sourceCode').value.split('\n').length);
  $('lineNumbers').textContent = Array.from({ length: lines }, (_, index) => index + 1).join('\n');
  $('sourceCount').textContent = `${$('sourceCode').value.length.toLocaleString()} characters`;
}
function makeNode(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? ''); return node;
}
function actionButton(label, callback) {
  const button = makeNode('button', 'mini-button', label); button.type = 'button'; button.addEventListener('click', callback); return button;
}
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(state.toastTimer); state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}
async function copyText(value, label) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const helper = document.createElement('textarea'); helper.value = value; helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.append(helper); helper.select();
    const copied = document.execCommand('copy'); helper.remove();
    if (!copied) { showToast('Clipboard access is unavailable in this browser.'); return; }
  }
  showToast(`${label} copied`);
}
function downloadText(value, filename) {
  const blob = new Blob([value], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function extension() {
  const map = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', cpp: 'cpp', go: 'go', rust: 'rs', ruby: 'rb', bash: 'sh' };
  return map[$('language').value] || 'txt';
}
function codeSection(title, code, filename, { canApply = false, verifyCandidate = false } = {}) {
  const section = makeNode('section', 'report-block'); section.append(makeNode('div', 'report-label', title));
  const box = makeNode('div', 'codebox'); const header = makeNode('div', 'codebox-head'); const actions = makeNode('div', 'mini-actions');
  actions.append(actionButton('Copy', () => copyText(code, title)), actionButton('Download', () => downloadText(code, filename)));
  if (canApply) {
    actions.append(actionButton('Use in editor', () => { $('sourceCode').value = code; updateLineNumbers(); $('sourceCode').focus(); showToast('Suggestion applied to the editor'); }));
    actions.append(actionButton('Restore original', () => { $('sourceCode').value = state.originals[state.mode] || ''; updateLineNumbers(); $('sourceCode').focus(); showToast('Original source restored'); }));
  }
  header.append(makeNode('span', '', filename), actions); box.append(header, makeNode('pre', '', code)); section.append(box);
  if (verifyCandidate) {
    const button = actionButton(state.trimVerification ? 'Check candidate syntax again' : 'Check candidate syntax', () => runTool('verify', code, state.trimLanguage));
    button.className = 'mini-button candidate-verify'; button.disabled = !String(code || '').trim() || state.activeRequestMode !== null; section.append(button);
    if (!String(code || '').trim()) section.append(makeNode('p', 'field-hint', 'An empty candidate cannot be sent to the verifier.'));
  }
  return section;
}
function diffSection(diff) {
  const section = makeNode('section', 'report-block'); section.append(makeNode('div', 'report-label', 'DIFF'));
  const box = makeNode('div', 'diff');
  if (!diff) box.append(makeNode('span', 'diff-line meta', 'No textual changes detected.'));
  else diff.split('\n').forEach((line) => {
    const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++') ? 'meta' : '';
    box.append(makeNode('span', `diff-line ${kind}`, line || ' '));
  });
  const actions = makeNode('div', 'report-actions'); actions.append(actionButton('Copy diff', () => copyText(diff || '', 'Diff')));
  section.append(box, actions); return section;
}
function unifiedDiff(before, after) {
  const oldLines = String(before ?? '').split('\n'); const newLines = String(after ?? '').split('\n');
  if (oldLines.length * newLines.length > 250000) return 'Diff omitted: source is too large for an in-browser comparison.';
  const matrix = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) for (let j = newLines.length - 1; j >= 0; j--) matrix[i][j] = oldLines[i] === newLines[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  const lines = ['--- original', '+++ candidate', '@@']; let i = 0; let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { lines.push(` ${oldLines[i]}`); i++; j++; }
    else if (j < newLines.length && (i >= oldLines.length || matrix[i][j + 1] >= matrix[i + 1][j])) lines.push(`+${newLines[j++]}`);
    else lines.push(`-${oldLines[i++]}`);
  }
  return lines.join('\n');
}
function noticesBlock(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return null;
  const box = makeNode('div', 'report-notices'); const list = document.createElement('ul'); warnings.forEach((warning) => list.append(makeNode('li', '', warning))); box.append(list); return box;
}
function appendRequestError(parent, message, mode) {
  const row = makeNode('div', 'retry-row'); const text = makeNode('span', 'retry-message', message); text.setAttribute('role', 'alert');
  const retry = actionButton('Retry request', () => runTool(mode)); retry.disabled = state.activeRequestMode !== null; row.append(text, retry); parent.append(row);
}
function renderDebug(parent, data) {
  parent.append(makeNode('div', 'report-banner warning', 'AI-generated fix suggestion. Review the diagnosis and proposed code, then run your own tests.'));
  parent.append(makeNode('div', 'report-label', 'DIAGNOSIS'), makeNode('p', 'report-copy', data.diagnosis));
  parent.append(makeNode('div', 'report-label', 'EXPLANATION'), makeNode('p', 'report-copy', data.explanation));
  const assumptions = getAssumptionsText(data);
  if (assumptions !== null) parent.append(makeNode('div', 'report-label', 'ASSUMPTIONS'), makeNode('p', 'report-copy', assumptions));
  parent.append(codeSection('ORIGINAL SOURCE', state.originals.debug, `repodoctor-original.${extension()}`));
  parent.append(codeSection('PROPOSED CODE', data.proposed_code, `repodoctor-proposed.${extension()}`, { canApply: true }));
  parent.append(diffSection(data.diff)); const notices = noticesBlock(data.warnings); if (notices) parent.append(notices);
  setStatus(data.status === 'suggestion_generated' ? 'SUGGESTION · REVIEW' : 'UNEXPECTED RESPONSE', data.status === 'suggestion_generated' ? 'warning' : 'error');
}
function renderTrim(parent, data) {
  const verification = state.trimVerification && state.trimVerification.language === state.trimLanguage && state.trimVerification.code === data.candidate_code ? state.trimVerification : null;
  const banner = makeNode('div', `report-banner ${verification?.status === 'passed_syntax_check' ? 'passed' : verification?.status === 'failed_syntax_check' ? 'failed' : 'warning'}`);
  banner.textContent = verification?.status === 'passed_syntax_check'
    ? `Syntax check passed for this ${verification.language} candidate. Runtime behavior and safety remain unverified.`
    : verification?.status === 'failed_syntax_check'
      ? `Candidate syntax check failed: ${verification.message}`
      : verification?.status === 'not_supported'
        ? `The verifier does not support ${verification.language}; this candidate remains unverified.`
        : 'This candidate has not been syntax-checked. Shorter code is not necessarily better or behaviorally equivalent.';
  parent.append(banner);
  const stats = makeNode('div', 'stats');
  [[`${data.original_lines} → ${data.candidate_lines}`, 'Lines: original → candidate'], [`${data.original_characters} → ${data.candidate_characters}`, 'Characters: original → candidate'], [`${data.character_reduction_percent}%`, 'Character reduction']].forEach(([value, label]) => {
    const card = makeNode('div', 'stat'); card.append(makeNode('strong', '', value), makeNode('span', '', label)); stats.append(card);
  });
  parent.append(stats, makeNode('div', 'report-label', 'EXPLANATION'), makeNode('p', 'report-copy', data.explanation));
  parent.append(codeSection('ORIGINAL SOURCE', data.original_code, `repodoctor-original.${extension()}`));
  parent.append(codeSection('CANDIDATE CODE · NOT VERIFIED', data.candidate_code, `repodoctor-trimmed.${extension()}`, { canApply: true, verifyCandidate: true }));
  parent.append(diffSection(unifiedDiff(data.original_code, data.candidate_code)));
  if (verification) parent.append(makeNode('p', 'report-copy', `Syntax check: ${verification.message}`));
  const notices = noticesBlock(data.warnings); if (notices) parent.append(notices);
  const status = verification?.status === 'passed_syntax_check' ? ['SYNTAX PASSED · BEHAVIOR UNVERIFIED', 'success'] : verification?.status === 'failed_syntax_check' ? ['SYNTAX CHECK FAILED', 'warning'] : verification?.status === 'not_supported' ? ['NOT SUPPORTED · UNVERIFIED', 'warning'] : data.status === 'not_verified' ? ['NOT VERIFIED', 'warning'] : ['UNEXPECTED RESPONSE', 'error'];
  setStatus(...status);
}
function renderVerify(parent, data) {
  const passed = data.status === 'passed_syntax_check'; const unsupported = data.status === 'not_supported';
  parent.append(makeNode('div', `verify-result ${passed ? 'passed' : unsupported ? 'unsupported' : 'failed'}`, passed ? 'Syntax check passed' : unsupported ? 'Language not supported' : 'Syntax check failed'));
  parent.append(makeNode('div', 'report-label', `${data.language || 'Selected language'} · STATIC SYNTAX CHECK`), makeNode('p', 'report-copy', data.message));
  parent.append(makeNode('p', 'report-notices', 'Syntax validation does not prove runtime correctness or safety. Submitted code was not executed.'));
  setStatus(passed ? 'SYNTAX PASSED' : unsupported ? 'NOT SUPPORTED' : 'SYNTAX FAILED', passed ? 'success' : 'warning');
}
function renderResult() {
  const parent = $('resultContent'); const mode = state.mode; const data = state.results[mode]; const error = state.errors[mode]; const loading = state.activeRequestMode === mode;
  parent.setAttribute('aria-busy', String(loading)); parent.replaceChildren();
  if (loading) {
    const banner = makeNode('div', 'loading-state'); banner.append(makeNode('span', 'spinner', ''), makeNode('span', '', data ? `Updating ${modeLabels[mode]}… Previous result remains available below.` : `Waiting for the ${modeLabels[mode]} response from FastAPI…`)); parent.append(banner);
  }
  if (!data && !error && !loading) {
    const empty = makeNode('div', 'empty-state');
    empty.append(makeNode('span', 'empty-glyph', mode === 'verify' ? '✓' : mode === 'trim' ? '↔' : '⌘'), makeNode('h3', '', mode === 'debug' ? 'Nothing to review yet' : mode === 'trim' ? 'Comparison will appear here' : 'Syntax result will appear here'));
    empty.append(makeNode('p', '', mode === 'debug' ? 'Add your code, then run a diagnosis. The original stays untouched while you review suggestions.' : mode === 'trim' ? 'Compare the original and candidate, check syntax if useful, then decide what to apply.' : 'The verifier checks Python syntax only and never executes code.'));
    parent.append(empty);
  }
  if (data) {
    if (mode === 'debug') renderDebug(parent, data); else if (mode === 'trim') renderTrim(parent, data); else renderVerify(parent, data);
  }
  if (error) {
    appendRequestError(parent, error, mode);
    const errorStatus = statusFromError(error, mode); setStatus(...errorStatus);
  } else if (loading) setStatus(data ? 'UPDATING' : 'PROCESSING', 'warning');
  else if (!data) setStatus('AWAITING INPUT');
}
function statusFromError(error, mode) {
  if (mode === 'verify') return error.httpStatus === 503 || !error.httpStatus ? ['VERIFICATION UNAVAILABLE', 'error'] : ['VERIFY REQUEST FAILED', 'error'];
  return ['REQUEST FAILED', 'error'];
}
function checkPayload(mode, data) {
  if (mode === 'debug') return typeof data.diagnosis === 'string' && typeof data.explanation === 'string' && typeof data.proposed_code === 'string' && typeof data.diff === 'string' && Array.isArray(data.warnings) && typeof data.status === 'string';
  if (mode === 'trim') return ['original_lines', 'candidate_lines', 'original_characters', 'candidate_characters', 'character_reduction_percent', 'original_code', 'candidate_code', 'explanation', 'warnings', 'status'].every((key) => key in data) && typeof data.original_code === 'string' && typeof data.candidate_code === 'string' && Array.isArray(data.warnings);
  return typeof data.language === 'string' && typeof data.message === 'string' && ['passed_syntax_check', 'failed_syntax_check', 'not_supported'].includes(data.status);
}
async function runTool(requestMode = state.mode, codeOverride = null, languageOverride = null) {
  if (state.activeRequestMode !== null) return;
  const code = codeOverride ?? $('sourceCode').value; const language = languageOverride ?? $('language').value;
  if (!code.trim()) { state.errors[requestMode] = 'Add source code before submitting.'; renderResult(); return; }
  if (code.length > 20000) { state.errors[requestMode] = 'The backend accepts a maximum of 20,000 characters. Shorten the code and try again.'; renderResult(); return; }
  try { apiBase(); } catch (error) { state.errors[requestMode] = error.message; renderResult(); setConnection('offline', error.message, 'Enter a valid FastAPI URL using http:// or https://.'); return; }
  const endpoint = requestMode === 'debug' ? '/api/v1/debug' : requestMode === 'trim' ? '/api/v1/trim' : '/api/v1/verify';
  const body = { code, language };
  if (requestMode === 'debug') body.error_message = $('errorMessage').value;
  if (requestMode === 'trim') body.goal = $('trimGoal').value.trim() || 'Simplify the code without changing its behavior. Keep it readable.';
  state.errors[requestMode] = null; state.activeRequestMode = requestMode;
  if (requestMode === 'verify' && state.results.trim?.candidate_code === code && state.trimLanguage === language) state.trimVerification = null;
  updateRunButton(); renderResult();
  try {
    const data = await apiRequest(endpoint, { method: 'POST', body, timeoutMs: 150000 });
    if (!checkPayload(requestMode, data)) throw new Error('The backend response did not match the expected API schema. Check that frontend and backend versions match.');
    state.results[requestMode] = data; state.errors[requestMode] = null;
    if (requestMode === 'debug' || requestMode === 'trim') state.originals[requestMode] = code;
    if (requestMode === 'trim') { state.trimLanguage = language; state.trimVerification = null; }
    if (requestMode === 'verify' && state.results.trim && code === state.results.trim.candidate_code && language === state.trimLanguage) {
      state.trimVerification = { code, language, status: data.status, message: data.message };
    }
    setConnection('online', 'FastAPI connected · response received');
  } catch (error) {
    if (error.code === 'NETWORK_OR_CORS' || error.code === 'TIMEOUT') {
      const diagnosis = await diagnoseConnectionFailure(error);
      state.errors[requestMode] = diagnosis.message;
      setConnection(diagnosis.state, diagnosis.title, diagnosis.message);
    } else {
      state.errors[requestMode] = error.message || 'Request failed. Check the backend and retry.';
      if (error.httpStatus === 503) setConnection('degraded', 'FastAPI reachable · Ollama or configured model unavailable', error.message);
      else if (error.httpStatus) setConnection('degraded', `Backend responded · HTTP ${error.httpStatus}`, error.message);
    }
  } finally { state.activeRequestMode = null; updateRunButton(); renderResult(); }
}
function formatModels(models) {
  if (!Array.isArray(models) || models.length === 0) return 'No models were returned by the backend.';
  const names = models.map((model) => typeof model === 'string' ? model : model && (model.name || model.model)).filter((name) => typeof name === 'string' && name);
  return names.length ? `Ollama models: ${names.join(', ')}` : 'The backend returned models without names.';
}
async function checkConnection() {
  if (state.connectionRequestActive || state.activeRequestMode !== null) return;
  try { apiBase(); }
  catch (error) { setConnection('offline', 'Invalid FastAPI URL', error.message); return; }
  state.connectionRequestActive = true; const button = $('checkConnection'); button.disabled = true; button.textContent = 'Checking…';
  setConnection('degraded', 'Checking FastAPI and Ollama…', 'Requesting /health and /api/v1/models.');
  try {
    const health = await apiRequest('/health', { timeoutMs: 12000 });
    const classified = classifyHealthResponse(health);
    let modelText = 'Model list was not checked.'; let models = null; let modelError = null;
    try { models = await apiRequest('/api/v1/models', { timeoutMs: 12000 }); modelText = formatModels(models.models); }
    catch (error) { modelError = error; modelText = `Could not load models: ${error.message}`; }
    if (classified.state === 'offline') setConnection('offline', classified.message, modelText);
    else if (classified.state === 'degraded') setConnection('degraded', classified.message, modelText);
    else if (modelError?.httpStatus === 503) setConnection('degraded', 'FastAPI reachable · Ollama is unavailable', modelText);
    else if (modelError) setConnection('degraded', 'FastAPI and Ollama responded, but the model list request failed.', modelText);
    else if (!Array.isArray(models.models)) setConnection('degraded', 'FastAPI returned an unexpected models response.', modelText);
    else if (models.models.length === 0) setConnection('degraded', 'Ollama is reachable, but no models were found.', modelText);
    else setConnection('online', `${classified.message}${Number.isInteger(health.model_count) ? ` · ${health.model_count} model(s)` : ''}`, modelText);
  } catch (error) {
    if (error.code === 'NETWORK_OR_CORS' || error.code === 'TIMEOUT') {
      const diagnosis = await diagnoseConnectionFailure(error);
      setConnection(diagnosis.state, diagnosis.title, diagnosis.message);
    } else setConnection('offline', 'FastAPI request failed', error.message || 'Connection check failed.');
  }
  finally { state.connectionRequestActive = false; button.disabled = false; button.textContent = 'Check connection'; }
}
function loadSample() {
  $('sourceCode').value = samples[state.mode]; $('errorMessage').value = state.mode === 'debug' ? 'Expected addition, but the function subtracts.' : '';
  updateLineNumbers(); $('sourceCode').focus(); showToast(`${modeLabels[state.mode]} sample loaded`);
}
function init() {
  try { $('apiBase').value = localStorage.getItem('repodoctor-api-base') || DEFAULT_API; } catch { $('apiBase').value = DEFAULT_API; }
  $('apiBase').addEventListener('change', () => {
    try { localStorage.setItem('repodoctor-api-base', apiBase()); } catch { /* Continue with the value in the field if storage is disabled. */ }
    checkConnection();
  });
  $('sourceCode').addEventListener('input', updateLineNumbers);
  $('sourceCode').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('sourceCode').scrollTop; });
  $('sourceCode').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { event.preventDefault(); const start = event.target.selectionStart; const end = event.target.selectionEnd; event.target.setRangeText('    ', start, end, 'end'); updateLineNumbers(); }
  });
  document.querySelectorAll('.tool-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  document.querySelector('.tool-tabs').addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('.tool-tab')]; const current = tabs.indexOf(document.activeElement); let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); setMode(tabs[next].dataset.mode, true);
  });
  $('loadSample').addEventListener('click', loadSample);
  $('runAction').addEventListener('click', () => runTool());
  $('verifyAction').addEventListener('click', () => { setMode('verify'); runTool('verify'); });
  $('checkConnection').addEventListener('click', checkConnection);
  $('sourceCode').value = samples.debug; $('errorMessage').value = 'Expected addition, but the function subtracts.'; updateLineNumbers();
  setMode('debug'); checkConnection();
}
init();
