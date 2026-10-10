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
