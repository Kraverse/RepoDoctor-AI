import { fetchRepositoryFile, listRepositoryBranches, listRepositoryFiles, parseRepositoryUrl } from './github-import.js';
const $ = id => document.getElementById(id);
const languageByExtension = { py:'python', pyi:'python', js:'javascript', jsx:'javascript', mjs:'javascript', cjs:'javascript', ts:'typescript', tsx:'typescript', java:'java', c:'cpp', h:'cpp', cpp:'cpp', hpp:'cpp', cc:'cpp', go:'go', rs:'rust', rb:'ruby', sh:'bash', bash:'bash' };
const state = { repository: null, branch: '', files: [], selectedPath: '', busy: false };
function status(message, tone = '') { const node = $('githubImportStatus'); node.textContent = message; node.dataset.tone = tone; }
function busy(value) { state.busy = value; $('connectGithub').disabled = value; $('loadGithubFiles').disabled = value || !state.repository || !state.branch; $('githubBranch').disabled = value || !state.repository; }
function clearFiles() {
  state.files = []; state.selectedPath = ''; $('githubFileList').replaceChildren(); $('githubSelectedFile').textContent = 'No file selected';
  ['analyzeGithubDebug','analyzeGithubTrim','analyzeGithubVerify'].forEach(id => $(id).disabled = true);
}
function renderFiles() {
  const list = $('githubFileList'); list.replaceChildren();
  if (!state.files.length) { const p = document.createElement('p'); p.className = 'github-empty'; p.textContent = 'No supported source files found on this branch.'; list.append(p); return; }
  state.files.forEach(file => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'github-file'; button.textContent = file.path;
    button.title = file.path + ' · ' + file.size.toLocaleString() + ' bytes'; button.setAttribute('aria-label', 'Load ' + file.path);
    button.addEventListener('click', () => selectFile(file)); list.append(button);
  });
}
async function selectFile(file) {
  if (state.busy) return;
  busy(true); status('Loading ' + file.path + '…');
  try {
    const content = await fetchRepositoryFile(state.repository, state.branch, file.path);
    $('sourceCode').value = content; $('sourceCode').dispatchEvent(new Event('input', { bubbles: true }));
    const ext = file.path.split('.').pop().toLowerCase(); if (languageByExtension[ext]) $('language').value = languageByExtension[ext];
    state.selectedPath = file.path;
    $('githubSelectedFile').textContent = 'Source loaded: ' + state.repository.fullName + ' · ' + state.branch + ' · ' + file.path;
    $('githubFileList').querySelectorAll('.github-file').forEach(node => node.classList.toggle('selected', node.textContent === file.path));
    ['analyzeGithubDebug','analyzeGithubTrim','analyzeGithubVerify'].forEach(id => $(id).disabled = false);
    status('File loaded into the editor. Imported code is never executed.', 'success');
  } catch (error) { status(error.message, 'error'); }
  finally { busy(false); }
}
async function connectRepository() {
  if (state.busy) return;
  busy(true); clearFiles();
  try {
    const repository = parseRepositoryUrl($('githubRepoUrl').value);
    status('Connecting to public GitHub repository…');
    const result = await listRepositoryBranches(repository);
    state.repository = repository;
    const select = $('githubBranch'); select.replaceChildren();
    result.branches.forEach(branch => { const option = document.createElement('option'); option.value = branch; option.textContent = branch; select.append(option); });
    state.branch = result.branches.includes(result.defaultBranch) ? result.defaultBranch : result.branches[0];
    select.value = state.branch; $('loadGithubFiles').disabled = false;
    status('Connected to ' + repository.fullName + '. Choose a branch and load its source files.', 'success');
  } catch (error) { state.repository = null; status(error.message, 'error'); }
  finally { busy(false); }
}
async function loadFiles() {
  if (state.busy || !state.repository) return;
  state.branch = $('githubBranch').value; busy(true); clearFiles(); status('Reading repository tree…');
  try {
    const result = await listRepositoryFiles(state.repository, state.branch); state.files = result.files; renderFiles();
    const notes = [result.files.length + ' supported files'];
    if (result.oversized) notes.push(result.oversized + ' oversized files skipped');
    if (result.truncated) notes.push('display limited to ' + result.files.length);
    status(notes.join(' · ') + '. Select a file to import.', result.files.length ? 'success' : 'error');
  } catch (error) { status(error.message, 'error'); }
  finally { busy(false); }
}
function analyze(mode) {
  if (!state.selectedPath || !$('sourceCode').value.trim()) return;
  document.querySelector('.tool-tab[data-mode="' + mode + '"]')?.click();
  $('githubSelectedFile').textContent = 'Analyzing source from ' + state.repository.fullName + ' · branch ' + state.branch + ' · file ' + state.selectedPath + '. Code is not executed.';
  $('runAction').click(); $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function init() {
  $('connectGithub').addEventListener('click', connectRepository); $('loadGithubFiles').addEventListener('click', loadFiles);
  $('githubBranch').addEventListener('change', () => { state.branch = $('githubBranch').value; clearFiles(); $('loadGithubFiles').disabled = !state.repository; status('Branch changed. Load files to browse this branch.'); });
  $('analyzeGithubDebug').addEventListener('click', () => analyze('debug'));
  $('analyzeGithubTrim').addEventListener('click', () => analyze('trim'));
  $('analyzeGithubVerify').addEventListener('click', () => analyze('verify'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();