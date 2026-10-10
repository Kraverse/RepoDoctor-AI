import { classifyHealthResponse, createApiClient, getAssumptionsText } from './api.js';

const DEFAULT_API = 'http://127.0.0.1:8000';
const $ = (id) => document.getElementById(id);
const state = { mode: 'debug', busy: false, original: '', currentResult: null, toastTimer: null };
const samples = {
  debug: 'def add_numbers(a, b):\n    return a - b\n\nprint(add_numbers(2, 3))',
  trim: 'def get_total(items):\n    total = 0\n    for item in items:\n        total = total + item\n    return total',
};

function apiBase() {
  return ($('apiBase').value.trim() || DEFAULT_API).replace(/\/+$/, '');
}
const apiRequest = createApiClient({ getBase: apiBase });

function setConnection(status, text) {
  const item = $('connection');
  item.classList.remove('online', 'offline', 'degraded');
  if (status) item.classList.add(status);
  item.querySelector('span').textContent = text;
}
function setBusy(busy) {
  state.busy = busy;
  $('runAction').disabled = busy;
  $('verifyAction').disabled = busy;
  $('resultContent').setAttribute('aria-busy', String(busy));
  if (busy) {
    $('resultStatus').textContent = 'WORKING'; $('resultStatus').className = 'result-status';
    $('resultContent').innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><span>Waiting for the local model…</span></div>';
  }
  updateRunButton();
}
function updateRunButton() {
  const label = state.mode === 'debug' ? 'Diagnose code' : 'Find a simpler version';
  $('runAction').innerHTML = `<span>${state.busy ? 'Working…' : label}</span><span aria-hidden="true">${state.busy ? '· · ·' : '↗'}</span>`;
}
function setStatus(text, tone = '') {
  $('resultStatus').textContent = text;
  $('resultStatus').className = `result-status${tone ? ` ${tone}` : ''}`;
}
function setMode(mode) {
  if (state.busy) return;
  state.mode = mode;
  document.querySelectorAll('.tool-tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $('workspace').setAttribute('aria-labelledby', `tab-${mode}`);
  $('resultHeading').textContent = mode === 'debug' ? 'Diagnosis' : 'CodeTrim review';
  $('debugFields').classList.toggle('hidden', mode !== 'debug');
  $('trimFields').classList.toggle('hidden', mode !== 'trim');
  updateRunButton();
  setStatus('READY');
  if (state.currentResult?.mode === mode) renderResult(state.currentResult);
  else showEmpty();
}
function updateLineNumbers() {
  const lines = Math.max(1, $('sourceCode').value.split('\n').length);
  $('lineNumbers').textContent = Array.from({ length: lines }, (_, index) => index + 1).join('\n');
  $('sourceCount').textContent = `${$('sourceCode').value.length.toLocaleString()} characters`;
}
function showEmpty() {
  state.currentResult = null;
  $('resultContent').setAttribute('aria-busy', 'false');
  $('resultContent').innerHTML = `<div class="empty-state"><span class="empty-glyph" aria-hidden="true">⌘</span><h3>Nothing to review yet</h3><p>${state.mode === 'debug' ? 'Add your code, then run a diagnosis. The original stays untouched while you review suggestions.' : 'Add your code and a goal, then compare the candidate before deciding what to keep.'}</p></div>`;
}
function showError(message, status = 'REQUEST FAILED') {
  state.currentResult = null;
  $('resultContent').setAttribute('aria-busy', 'false');
  $('resultContent').textContent = '';
  const box = document.createElement('div'); box.className = 'report-notices'; box.textContent = message;
  $('resultContent').append(box); setStatus(status, 'error');
}
function escapeText(value) { return String(value ?? ''); }
function makeNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = escapeText(text);
  return node;
}
function actionButton(label, onClick) {
  const button = makeNode('button', 'mini-button', label); button.type = 'button'; button.addEventListener('click', onClick); return button;
}
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(state.toastTimer); state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}
async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement('textarea'); helper.value = value; helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.append(helper); helper.select();
    const copied = document.execCommand('copy'); helper.remove();
    if (!copied) { showToast('Clipboard access is unavailable in this browser.'); return; }
  }
  showToast(`${label} copied`);
}
function downloadText(value, filename) {
  const blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function codeSection(title, code, filename, canApply = false) {
  const section = makeNode('section', 'report-block');
  const label = makeNode('div', 'report-label', title); section.append(label);
  const box = makeNode('div', 'codebox'); const header = makeNode('div', 'codebox-head');
  const name = makeNode('span', '', filename); const actions = makeNode('div', 'mini-actions');
  actions.append(actionButton('Copy', () => copyText(code, title)));
  actions.append(actionButton('Download', () => downloadText(code, filename)));
  if (canApply) {
    actions.append(actionButton('Use in editor', () => { $('sourceCode').value = code; updateLineNumbers(); showToast('Candidate copied into the editor'); }));
    actions.append(actionButton('Restore original', () => { $('sourceCode').value = state.original; updateLineNumbers(); showToast('Original source restored'); }));
  }
  header.append(name, actions); const pre = makeNode('pre', '', code); box.append(header, pre); section.append(box); return section;
}
function diffSection(diff) {
  const section = makeNode('section', 'report-block'); const label = makeNode('div', 'report-label', 'DIFF');
  const box = makeNode('div', 'diff');
  if (!diff) box.append(makeNode('span', 'diff-line meta', 'No textual changes detected.'));
  else diff.split('\n').forEach((line) => {
    const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++') ? 'meta' : '';
    box.append(makeNode('span', `diff-line ${kind}`, line || ' '));
  });
  const actions = makeNode('div', 'report-actions'); actions.append(actionButton('Copy diff', () => copyText(diff || '', 'Diff')));
  section.append(label, box, actions); return section;
}
function noticesBlock(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return null;
  const box = makeNode('div', 'report-notices'); const list = document.createElement('ul');
  warnings.forEach((warning) => list.append(makeNode('li', '', warning))); box.append(list); return box;
}
function renderDebug(data) {
  const result = $('resultContent');
  result.append(makeNode('div', 'report-label', 'DIAGNOSIS'), makeNode('p', 'report-copy', data.diagnosis));
  result.append(makeNode('div', 'report-label', 'EXPLANATION'), makeNode('p', 'report-copy', data.explanation));
  const assumptions = getAssumptionsText(data);
  if (assumptions !== null) {
    result.append(makeNode('div', 'report-label', 'ASSUMPTIONS'), makeNode('p', 'report-copy', assumptions));
  }
  result.append(codeSection('ORIGINAL SOURCE', state.original, `repodoctor-original.${extension()}`));
  result.append(codeSection('PROPOSED CODE', data.proposed_code, `repodoctor-proposed.${extension()}`, true));
  result.append(diffSection(data.diff));
  const notices = noticesBlock(data.warnings); if (notices) result.append(notices);
  if (data.status === 'suggestion_generated') setStatus('SUGGESTION · REVIEW', 'warning');
  else setStatus('UNEXPECTED RESPONSE', 'error');
}
function renderTrim(data) {
  const result = $('resultContent'); const stats = makeNode('div', 'stats');
  const pairs = [
    [`${data.original_lines} → ${data.candidate_lines}`, 'Lines'],
    [`${data.original_characters} → ${data.candidate_characters}`, 'Characters'],
    [`${data.character_reduction_percent}%`, 'Character reduction'],
  ];
  pairs.forEach(([value, label]) => { const card = makeNode('div', 'stat'); card.append(makeNode('strong', '', value), makeNode('span', '', label)); stats.append(card); });
  result.append(stats, makeNode('div', 'report-label', 'EXPLANATION'), makeNode('p', 'report-copy', data.explanation));
  result.append(codeSection('ORIGINAL SOURCE', data.original_code, `repodoctor-original.${extension()}`));
  result.append(codeSection('CANDIDATE CODE · NOT VERIFIED', data.candidate_code, `repodoctor-trimmed.${extension()}`, true));
  result.append(diffSection(unifiedDiff(data.original_code, data.candidate_code)));
  const notices = noticesBlock(data.warnings); if (notices) result.append(notices);
  if (data.status === 'not_verified') setStatus('NOT VERIFIED', 'warning');
  else setStatus('UNEXPECTED RESPONSE', 'error');
}
function unifiedDiff(before, after) {
  // A lightweight LCS-based diff for a clear, line-level review; it is display-only.
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
function renderVerify(data) {
  const result = $('resultContent'); result.append(makeNode('div', 'report-label', 'PYTHON SYNTAX VERIFICATION'));
  const passed = data.status === 'passed_syntax_check'; const unsupported = data.status === 'not_supported';
  const callout = makeNode('div', 'report-notices');
  callout.style.background = passed ? '#17231a' : unsupported ? '#282319' : '#291b1a';
  callout.style.borderColor = passed ? '#3e5940' : unsupported ? '#4e422c' : '#573b39';
  callout.style.color = passed ? '#b8efa0' : unsupported ? '#e9c477' : '#f3a19b';
  callout.textContent = `${passed ? 'Syntax check passed. ' : unsupported ? 'Language not supported. ' : 'Syntax check failed. '}${data.message || 'No details returned.'}`;
  result.append(callout, makeNode('p', 'report-copy', 'A successful Python syntax parse does not prove runtime behavior or correctness. No submitted code was executed.'));
  setStatus(passed ? 'SYNTAX PASSED' : unsupported ? 'NOT SUPPORTED' : 'SYNTAX FAILED', passed ? 'success' : 'warning');
}
function renderResult(result) {
  $('resultContent').textContent = ''; $('resultContent').setAttribute('aria-busy', 'false');
  if (result.mode === 'debug') renderDebug(result.data);
  else if (result.mode === 'trim') renderTrim(result.data);
  else renderVerify(result.data);
}
function extension() {
  const map = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', cpp: 'cpp', go: 'go', rust: 'rs', ruby: 'rb', bash: 'sh' };
  return map[$('language').value] || 'txt';
}
async function runAction() {
  if (state.busy) return;
  const code = $('sourceCode').value; const language = $('language').value;
  if (!code.trim()) { showError('Add some source code before running this tool.'); return; }
  if (code.length > 20000) { showError('The backend accepts a maximum of 20,000 characters. Shorten the code and try again.'); return; }
  const mode = state.mode; const body = mode === 'debug'
    ? { code, language, error_message: $('errorMessage').value }
    : { code, language, goal: $('trimGoal').value.trim() || 'Simplify the code without changing its behavior.' };
  setBusy(true);
  try {
    const data = await apiRequest(mode === 'debug' ? '/api/v1/debug' : '/api/v1/trim', { method: 'POST', body });
    const required = mode === 'debug' ? ['diagnosis', 'explanation', 'proposed_code', 'diff', 'warnings', 'status'] : ['original_lines', 'candidate_lines', 'original_characters', 'candidate_characters', 'character_reduction_percent', 'original_code', 'candidate_code', 'explanation', 'warnings', 'status'];
    if (!required.every((key) => key in data)) throw new Error('The backend response is missing expected fields. Check the API schema and frontend/backend versions.');
    if (mode === 'debug' && (!Array.isArray(data.warnings) || typeof data.proposed_code !== 'string')) throw new Error('The debugger response did not match the expected API schema.');
    if (mode === 'trim' && (!Array.isArray(data.warnings) || typeof data.candidate_code !== 'string')) throw new Error('The CodeTrim response did not match the expected API schema.');
    state.original = code;
    state.currentResult = { mode, data };
    renderResult(state.currentResult);
    setConnection('online', 'Backend connected');
  } catch (error) { showError(error.message); if (error.message.includes('connect') || error.message.includes('CORS')) setConnection('offline', 'Backend unavailable'); }
  finally { setBusy(false); }
}
async function verifyAction() {
  if (state.busy) return;
  const code = $('sourceCode').value; const language = $('language').value;
  if (!code.trim()) { showError('Add some source code before checking syntax.'); return; }
  if (code.length > 20000) { showError('The backend accepts a maximum of 20,000 characters. Shorten the code and try again.'); return; }
  setBusy(true);
  try {
    const data = await apiRequest('/api/v1/verify', { method: 'POST', body: { code, language } });
    if (!['passed_syntax_check', 'failed_syntax_check', 'not_supported'].includes(data.status) || typeof data.message !== 'string') throw new Error('The verification response did not match the expected API schema.');
    state.currentResult = { mode: 'verify', data }; renderResult(state.currentResult); setConnection('online', 'Backend connected');
  } catch (error) { showError(`Verification service unavailable: ${error.message}`, 'VERIFICATION UNAVAILABLE'); if (error.message.includes('connect') || error.message.includes('CORS')) setConnection('offline', 'Backend unavailable'); }
  finally { setBusy(false); }
}
async function checkHealth() {
  try {
    const health = await apiRequest('/health', { timeoutMs: 12000 });
    const healthStatus = classifyHealthResponse(health);
    if (healthStatus.state !== 'online') { setConnection(healthStatus.state, healthStatus.message); return; }
    try {
      const models = await apiRequest('/api/v1/models', { timeoutMs: 12000 });
      if (!Array.isArray(models.models)) throw new Error('The models response did not match the expected API schema.');
      const modelLabel = models.models.map((model) => model.name || model.model).filter(Boolean).join(', ');
      const availabilityNote = healthStatus.modelAvailabilityReported === false
        ? ' · configured model availability not reported'
        : '';
      setConnection('online', `Ollama connected${modelLabel ? ` · ${modelLabel}` : ''}${availabilityNote}`);
    } catch { setConnection('online', 'Ollama connected · model list unavailable'); }
  } catch (error) { setConnection('offline', error.message.includes('connect') ? 'Backend unavailable' : 'Backend status unknown'); }
}
function loadSample() {
  $('sourceCode').value = samples[state.mode] || samples.debug;
  $('errorMessage').value = state.mode === 'debug' ? 'Expected addition, but the function subtracts.' : '';
  updateLineNumbers(); showToast(`${state.mode === 'debug' ? 'Debugger' : 'CodeTrim'} sample loaded`);
}
function init() {
  $('apiBase').value = localStorage.getItem('repodoctor-api-base') || DEFAULT_API;
  $('apiBase').addEventListener('change', () => { const value = apiBase(); localStorage.setItem('repodoctor-api-base', value); checkHealth(); });
  $('sourceCode').addEventListener('input', updateLineNumbers);
  $('sourceCode').addEventListener('scroll', () => { $('lineNumbers').scrollTop = $('sourceCode').scrollTop; });
  $('sourceCode').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { event.preventDefault(); const start = event.target.selectionStart; const end = event.target.selectionEnd; event.target.setRangeText('    ', start, end, 'end'); updateLineNumbers(); }
  });
  document.querySelectorAll('.tool-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  document.querySelector('.tool-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const next = state.mode === 'debug' ? 'trim' : 'debug'; setMode(next); $(`tab-${next}`).focus();
  });
  $('loadSample').addEventListener('click', loadSample);
  $('runAction').addEventListener('click', runAction);
  $('verifyAction').addEventListener('click', verifyAction);
  $('sourceCode').value = samples.debug; $('errorMessage').value = 'Expected addition, but the function subtracts.'; updateLineNumbers();
  checkHealth();
}
init();
