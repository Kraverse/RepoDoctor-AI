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
        const value = data?.detail;
        const detail = typeof value === 'string'
          ? value
          : Array.isArray(value)
            ? value.map((entry) => {
              if (entry && typeof entry === 'object') {
                const location = Array.isArray(entry.loc) ? entry.loc.join(' → ') : 'Request';
                return `${location}: ${entry.msg || 'Invalid value'}`;
              }
              return String(entry);
            }).join('; ')
            : value && typeof value === 'object' && typeof value.message === 'string'
              ? value.message
              : `Request failed (HTTP ${response.status}).`;
        const error = new Error(detail);
        error.httpStatus = response.status;
        error.code = 'HTTP_ERROR';
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('The backend response had an unexpected format.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('The request timed out. Check that FastAPI and Ollama are running, then try again.');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      if (error instanceof TypeError) {
        const connectionError = new Error(`The browser could not read a response from ${base}.`);
        connectionError.code = 'NETWORK_OR_CORS';
        throw connectionError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * A no-CORS GET can tell whether a cross-origin endpoint responds at the network
 * level when a normal fetch is unreadable. An opaque response suggests CORS;
 * a rejection is inconclusive because network and browser local-access blocks
 * can both reject fetches.
 */
export async function probeBackend(base, { fetchImpl = (...args) => fetch(...args), timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base.replace(/\/+$/, '')}/health`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return { state: response.type === 'opaque' ? 'reachable_opaque' : 'reachable' };
  } catch (error) {
    return { state: error.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Interpret the fields returned by GET /health without conflating model and service failures. */
export function classifyHealthResponse(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)
    || !['ok', 'degraded'].includes(health.status)) {
    return { state: 'offline', message: 'Backend health response is incomplete' };
  }

  const modernResponse = health.api === 'ok';
  const legacyHealthyResponse = health.api === undefined
    && health.status === 'ok'
    && health.ollama === 'connected'
    && Number.isInteger(health.model_count)
    && health.model_count >= 0;
  const legacyUnavailableResponse = health.api === undefined
    && health.status === 'degraded'
    && health.ollama === 'unavailable';
  if (!modernResponse && !legacyHealthyResponse && !legacyUnavailableResponse) {
    return { state: 'offline', message: 'Backend health response is incomplete' };
  }

  if (health.ollama === 'unavailable') {
    return {
      state: 'degraded',
      message: modernResponse
        ? 'API online · Ollama unavailable · check that the Ollama service is running'
        : 'Ollama unavailable · check that the Ollama service is running',
    };
  }
  if (health.ollama !== 'connected') {
    return { state: 'degraded', message: 'API online · Ollama status unknown · health response is incomplete' };
  }

  if (health.configured_model_available === false) {
    const model = typeof health.configured_model === 'string' ? health.configured_model.trim() : '';
    return {
      state: 'degraded',
      message: model
        ? `Ollama connected · configured model missing: ${model}`
        : 'Ollama connected · configured model is missing',
    };
  }
  if (health.configured_model_available !== true) {
    if (legacyHealthyResponse) {
      return {
        state: 'online',
        message: 'Ollama connected · configured model availability not reported',
        modelAvailabilityReported: false,
      };
    }
    return { state: 'degraded', message: 'Ollama connected · configured model availability unknown' };
  }
  if (health.status === 'degraded') {
    return { state: 'degraded', message: 'Backend reports degraded health', modelAvailabilityReported: true };
  }

  return { state: 'online', message: 'Ollama connected', modelAvailabilityReported: true };
}

/** Return only assumptions actually supplied as nonempty text by the debug API. */
export function getAssumptionsText(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || typeof response.assumptions !== 'string' || !response.assumptions.trim()) {
    return null;
  }
  return response.assumptions;
}
