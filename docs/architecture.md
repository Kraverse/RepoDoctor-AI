# Architecture and safety boundaries

## Request flow

1. A client sends a request to the FastAPI service.
2. Pydantic validates request fields and enforces the configured `MAX_CODE_LENGTH`.
3. Debug and CodeTrim send JSON-encoded input data to the Ollama `/api/generate` endpoint using the configured local model. System instructions explicitly treat code and error text as untrusted data.
4. The API returns an AI suggestion, a unified diff, and (for CodeTrim) before/after size statistics. Suggestions are not proof of correctness.
5. The Verify endpoint uses Python's `ast.parse` for Python syntax only.
6. Health checks distinguish an alive API, reachable Ollama service, and availability of the configured model.

Request validation errors return HTTP 422 without echoing submitted source. Ollama transport, timeout, and malformed-response errors are mapped to safe HTTP 503 responses; server logs contain event names and exception types, not source code or raw exception contents.

## Important boundaries

- Model output is untrusted and must be reviewed.
- The API does not execute user-submitted code.
- A successful syntax parse does not demonstrate behavioral correctness.
- CodeTrim's character reduction is a simple text comparison, not a proof of optimality or readability.
- The initial deployment target is local development. A remote hosted backend cannot reach a developer's `localhost` Ollama instance by default.
- Keep secrets in environment variables and never commit `.env` files.
- Local `.env` values are loaded by `python-dotenv`; `MAX_CODE_LENGTH` is the current input-limit setting (`MAX_CODE_CHARS` remains a fallback for older setups).

## Next engineering steps

1. Run tests and fix failures before claiming CI is green.
2. Add a frontend editor and diff viewer.
3. Add deterministic regression fixtures for debug and trim suggestions.
4. Consider isolated execution only after a sandbox design with time, memory, network, and filesystem limits.
