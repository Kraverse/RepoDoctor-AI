/** Build a small JSON client for the RepoDoctor FastAPI backend. */
export function createApiClient({ getBase, fetchImpl = (...args) => fetch(...args) }) {
  return async function apiRequest(path, { method = 'GET', body, timeoutMs = 130000 } = {}) {
    const base = getBase().replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let data;
      try { data = await response.json(); }
      catch { throw new Error(`The backend returned an invalid response (HTTP ${response.status}).`); }
      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : `Request failed (HTTP ${response.status}).`;
        throw new Error(detail);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('The backend response had an unexpected format.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The request timed out. Check that FastAPI and Ollama are running, then try again.');
      }
      if (error instanceof TypeError) {
        throw new Error(`Could not connect to ${base}. Check the FastAPI address and CORS configuration.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
