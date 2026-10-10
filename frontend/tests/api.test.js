import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHealthResponse, createApiClient, getAssumptionsText } from '../api.js';

const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('sends JSON to the configured base URL and parses the response', async () => {
  let request;
  const client = createApiClient({ getBase: () => 'http://localhost:8000/', fetchImpl: async (...args) => { request = args; return jsonResponse({ status: 'passed_syntax_check' }); } });
  const result = await client('/api/v1/verify', { method: 'POST', body: { code: 'print(1)', language: 'python' } });
  assert.deepEqual(result, { status: 'passed_syntax_check' });
  assert.equal(request[0], 'http://localhost:8000/api/v1/verify');
  assert.equal(request[1].method, 'POST');
  assert.equal(request[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request[1].body), { code: 'print(1)', language: 'python' });
});

test('surfaces FastAPI validation and service errors', async () => {
  const client = createApiClient({ getBase: () => 'http://localhost:8000', fetchImpl: async () => jsonResponse({ detail: 'Ollama is unavailable.' }, 503) });
  await assert.rejects(client('/api/v1/models'), /Ollama is unavailable/);
});

test('reports invalid JSON and unexpected successful payloads', async () => {
  const invalidJson = createApiClient({ getBase: () => 'http://localhost:8000', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) });
  await assert.rejects(invalidJson('/health'), /invalid response/);
  const badShape = createApiClient({ getBase: () => 'http://localhost:8000', fetchImpl: async () => jsonResponse([]) });
  await assert.rejects(badShape('/health'), /unexpected format/);
});

test('explains network/CORS failures without replacing user input', async () => {
  const client = createApiClient({ getBase: () => 'http://localhost:8000', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(client('/api/v1/debug', { method: 'POST', body: { code: 'keep me', language: 'python' } }), /CORS configuration/);
});

test('aborts on timeout with a useful diagnostic', async () => {
  const client = createApiClient({ getBase: () => 'http://localhost:8000', fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); })) });
  await assert.rejects(client('/api/v1/debug', { timeoutMs: 5 }), /timed out/);
});

test('distinguishes an unavailable Ollama service from a missing configured model', () => {
  const modelMissing = classifyHealthResponse({
    api: 'ok',
    status: 'degraded',
    ollama: 'connected',
    configured_model: 'qwen2.5-coder:1.5b',
    configured_model_available: false,
  });
  assert.deepEqual(modelMissing, {
    state: 'degraded',
    message: 'Ollama connected · configured model missing: qwen2.5-coder:1.5b',
  });

  const ollamaUnavailable = classifyHealthResponse({
    api: 'ok',
    status: 'degraded',
    ollama: 'unavailable',
    configured_model: 'qwen2.5-coder:1.5b',
    configured_model_available: false,
  });
  assert.equal(ollamaUnavailable.state, 'degraded');
  assert.match(ollamaUnavailable.message, /^API online · Ollama unavailable/);
});

test('shows ready only for a complete healthy response and handles incomplete values', () => {
  assert.deepEqual(classifyHealthResponse({
    api: 'ok',
    status: 'ok',
    ollama: 'connected',
    configured_model: 'qwen2.5-coder:1.5b',
    configured_model_available: true,
  }), { state: 'online', message: 'Ollama connected' });

  for (const response of [
    null,
    [],
    {},
    { api: 'ok', status: 'unknown', ollama: 'connected', configured_model_available: true },
  ]) {
    assert.equal(classifyHealthResponse(response).state, 'offline');
  }
  assert.deepEqual(classifyHealthResponse({
    api: 'ok',
    status: 'ok',
    ollama: 'connected',
  }), {
    state: 'degraded',
    message: 'Ollama connected · configured model availability unknown',
  });
  assert.deepEqual(classifyHealthResponse({
    api: 'ok',
    status: 'ok',
    ollama: 'unknown',
    configured_model_available: true,
  }), {
    state: 'degraded',
    message: 'API online · Ollama status unknown · health response is incomplete',
  });
});

test('returns only nonempty assumptions supplied by the debug response', () => {
  assert.equal(getAssumptionsText({ assumptions: 'The input is Python 3.' }), 'The input is Python 3.');
  assert.equal(getAssumptionsText({ assumptions: '   ' }), null);
  assert.equal(getAssumptionsText({ assumptions: '' }), null);
  assert.equal(getAssumptionsText({}), null);
  assert.equal(getAssumptionsText({ assumptions: ['invented'] }), null);
  const untrusted = '<script>alert(1)</script>';
  assert.equal(getAssumptionsText({ assumptions: untrusted }), untrusted);
});
