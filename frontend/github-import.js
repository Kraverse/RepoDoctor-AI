export const MAX_SOURCE_CHARS = 20000;
export const MAX_SUPPORTED_FILES = 200;
export const SUPPORTED_EXTENSIONS = new Set(['.py','.pyi','.js','.jsx','.mjs','.cjs','.ts','.tsx','.java','.c','.h','.cpp','.hpp','.cc','.go','.rs','.rb','.php','.swift','.kt','.kts','.cs','.sh','.bash','.sql','.html','.css','.scss','.json','.yaml','.yml','.toml','.xml','.md','.txt','.vue','.svelte']);
const SKIP_PARTS = new Set(['node_modules','vendor','dist','build','.git','.next','coverage']);

export function parseRepositoryUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Enter a valid public GitHub repository URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) throw new Error('Use a standard https://github.com/owner/repository URL.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length && parts.at(-1).endsWith('.git')) parts[parts.length - 1] = parts.at(-1).slice(0, -4);
  if (parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')) throw new Error('Enter a repository URL in the format https://github.com/owner/repository.');
  return { owner: parts[0], repo: parts[1], fullName: parts.join('/'), url: 'https://github.com/' + parts.join('/') };
}
export function filterSupportedFiles(tree, maxFiles = MAX_SUPPORTED_FILES) {
  const files = []; let oversized = 0;
  for (const entry of Array.isArray(tree) ? tree : []) {
    if (entry?.type !== 'blob' || typeof entry.path !== 'string') continue;
    const parts = entry.path.split('/');
    if (parts.some(p => SKIP_PARTS.has(p))) continue;
    const filename = parts.at(-1); const dot = filename.lastIndexOf('.');
    if (!SUPPORTED_EXTENSIONS.has(dot >= 0 ? filename.slice(dot).toLowerCase() : '')) continue;
    if (Number(entry.size || 0) > MAX_SOURCE_CHARS) { oversized++; continue; }
    files.push({ path: entry.path, size: Number(entry.size || 0), sha: entry.sha || '' });
    if (files.length >= maxFiles) break;
  }
  return { files, oversized, truncated: files.length >= maxFiles };
}
export async function githubJson(url, fetchImpl = (...args) => fetch(...args)) {
  let response;
  try { response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } }); }
  catch { throw new Error('Could not reach GitHub. Check your internet connection and try again.'); }
  if (response.status === 403 || response.status === 429) {
    if (response.headers?.get?.('x-ratelimit-remaining') === '0' || response.status === 429) throw new Error('GitHub API rate limit reached. Wait a while or try again later.');
    throw new Error('GitHub denied this request. Public repositories only; private repositories need secure sign-in.');
  }
  if (response.status === 404) throw new Error('Repository, branch, or file not found. Private repositories are not supported in this version.');
  if (!response.ok) throw new Error('GitHub request failed (HTTP ' + response.status + ').');
  try { return await response.json(); } catch { throw new Error('GitHub returned an unreadable response.'); }
}
export async function listRepositoryBranches(repository, fetchImpl) {
  const base = 'https://api.github.com/repos/' + encodeURIComponent(repository.owner) + '/' + encodeURIComponent(repository.repo);
  const metadata = await githubJson(base, fetchImpl);
  if (metadata.private) throw new Error('Private repositories are not supported yet. No access token is requested or stored.');
  const branches = await githubJson(base + '/branches?per_page=100', fetchImpl);
  if (!Array.isArray(branches) || !branches.length) throw new Error('No branches were returned for this repository.');
  return { defaultBranch: metadata.default_branch, branches: branches.map(item => item.name).filter(Boolean) };
}
export async function listRepositoryFiles(repository, branch, fetchImpl) {
  if (!branch) throw new Error('Select a branch first.');
  const url = 'https://api.github.com/repos/' + encodeURIComponent(repository.owner) + '/' + encodeURIComponent(repository.repo) + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1';
  const data = await githubJson(url, fetchImpl);
  if (data.truncated) throw new Error('GitHub truncated this repository tree because it is too large. Try a smaller repository or a specific branch.');
  return filterSupportedFiles(data.tree);
}
export async function fetchRepositoryFile(repository, branch, path, fetchImpl = (...args) => fetch(...args)) {
  if (!repository?.owner || !repository?.repo || !branch || !path || path.split('/').some(part => part === '..')) throw new Error('Choose a valid repository file and branch first.');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = 'https://raw.githubusercontent.com/' + encodeURIComponent(repository.owner) + '/' + encodeURIComponent(repository.repo) + '/' + encodeURIComponent(branch) + '/' + encodedPath;
  let response;
  try { response = await fetchImpl(url); } catch { throw new Error('Could not download this source file from GitHub.'); }
  if (response.status === 404) throw new Error('File not found on the selected branch.');
  if (response.status === 429 || response.status === 403) throw new Error('GitHub rate limit reached or file access denied. Try again later.');
  if (!response.ok) throw new Error('Could not load file (HTTP ' + response.status + ').');
  const content = await response.text();
  if (content.length > MAX_SOURCE_CHARS) throw new Error('This file exceeds the 20,000-character analysis limit.');
  if (content.includes('\u0000')) throw new Error('This file appears to be binary and cannot be imported as source text.');
  return content;
}