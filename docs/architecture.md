# Architecture and safety boundaries

## Request flow

1. A client sends a request to the FastAPI service.
2. Pydantic validates request size and fields.
3. Debug and CodeTrim call the Ollama `/api/generate` endpoint using the configured local model.
4. The API returns the suggestion and a diff/size summary.
5. The Verify endpoint uses Python's `ast.parse` for Python syntax only.

## Important boundaries

- Model output is untrusted and must be reviewed.
- The API does not execute user-submitted code.
- A successful syntax parse does not demonstrate behavioral correctness.
- CodeTrim's character reduction is a simple text comparison, not a proof of optimality or readability.
- The initial deployment target is local development. A remote hosted backend cannot reach a developer's `localhost` Ollama instance by default.
- Keep secrets in environment variables and never commit `.env` files.

## Next engineering steps

1. Run tests and fix failures before claiming CI is green.
2. Add a frontend editor and diff viewer.
3. Add deterministic regression fixtures for debug and trim suggestions.
4. Consider isolated execution only after a sandbox design with time, memory, network, and filesystem limits.
