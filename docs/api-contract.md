# RepoDoctor AI API contract

The API is served by FastAPI, normally at `http://127.0.0.1:8000`. JSON request bodies use `Content-Type: application/json`. Source code is passed to the configured Ollama model; it is not executed by this service.

## `GET /`

Returns service and documentation links:

```json
{
  "name": "RepoDoctor AI",
  "version": "0.1.0",
  "docs": "/docs",
  "health": "/health",
  "api": "/api/v1"
}
```

## `GET /health`

The API can be alive while its model dependency is degraded. `status` is `ok` only when Ollama responds and the configured model is installed.

```json
{
  "api": "ok",
  "configured_model": "qwen2.5-coder:1.5b",
  "status": "ok",
  "ollama": "connected",
  "model_count": 1,
  "configured_model_available": true
}
```

If Ollama cannot be reached, `api` remains `"ok"`, `status` becomes `"degraded"`, `ollama` is `"unavailable"`, and `configured_model_available` is `false`. If Ollama responds but the configured model is missing, `ollama` is `"connected"` and `status` is `"degraded"`.

## `GET /api/v1/models`

Lists the model objects returned unchanged by Ollama's `/api/tags` endpoint and explicitly reports whether the configured model is present:

```json
{
  "ollama": "connected",
  "models": [{"name": "qwen2.5-coder:1.5b", "model": "qwen2.5-coder:1.5b"}],
  "configured_model": "qwen2.5-coder:1.5b",
  "configured_model_available": true
}
```

Returns HTTP `503` with a safe `detail` message if Ollama is unavailable or returns malformed data.

## `POST /api/v1/debug`

Request:

```json
{
  "code": "def add(a, b):\\n    return a - b",
  "language": "python",
  "error_message": "Expected addition"
}
```

`language` defaults to `"python"` and `error_message` defaults to an empty string.

Response:

```json
{
  "diagnosis": "The function uses subtraction.",
  "explanation": "Use addition to match the expected behavior.",
  "assumptions": "Addition was intended.",
  "proposed_code": "def add(a, b):\\n    return a + b",
  "diff": "--- original\\n+++ proposed\\n...",
  "warnings": ["AI output is a suggestion, not proof of correctness.", "No tests were executed by this endpoint."],
  "status": "suggestion_generated"
}
```

If Ollama returns a response without a parseable `CODE` section, the original code is returned unchanged and a warning is included.

## `POST /api/v1/trim`

Request:

```json
{
  "code": "def f(x):\\n    return x + 0",
  "language": "python",
  "goal": "Simplify without changing behavior"
}
```

`language` defaults to `"python"`; `goal` defaults to `"Simplify the code without changing its behavior."`.

The response includes the original and candidate source, line and character counts, character reduction percentage, explanation, unified diff, warnings, and `"status": "not_verified"`. A smaller candidate is not proof of equivalent behavior.

Example response shape:

```json
{
  "original_lines": 3,
  "candidate_lines": 2,
  "original_characters": 35,
  "candidate_characters": 25,
  "character_reduction_percent": 28.57,
  "original_code": "def f(x):\\n    return x + 0",
  "candidate_code": "def f(x):\\n    return x",
  "explanation": "Removed a redundant addition.",
  "diff": "--- original\\n+++ proposed\\n...",
  "warnings": [
    "Character reduction is a text-size comparison, not a quality score.",
    "Behavior has not been verified; review and test the candidate before using it."
  ],
  "status": "not_verified"
}
```

## `POST /api/v1/verify`

Request:

```json
{"code": "def add(a, b):\\n    return a + b", "language": "python"}
```

Response:

```json
{
  "language": "python",
  "status": "passed_syntax_check",
  "message": "Python syntax parsed successfully. This does not prove runtime behavior or correctness; no code was executed."
}
```

Statuses are `passed_syntax_check`, `failed_syntax_check`, or `not_supported`. Only Python syntax is checked.

## Errors and limits

- Invalid, blank, or oversized code returns HTTP `422` with a safe `detail` string and `errors` entries; submitted source is not echoed.
- Ollama connection failures, timeouts, malformed model output, or missing-model generation failures return HTTP `503` with a safe `detail` string. Internal exceptions are not returned.
- The maximum code length is controlled by `MAX_CODE_LENGTH` (default `20000`). `MAX_CODE_CHARS` remains accepted as a deprecated fallback.
