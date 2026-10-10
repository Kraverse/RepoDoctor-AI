# RepoDoctor AI

**Local-first AI debugging and code minimization powered by Ollama.**

RepoDoctor AI is an experimental developer tool that diagnoses code errors, proposes focused fixes, and explores simpler alternatives. It uses a local Ollama model by default, so the initial workflow does not require paid LLM API credits.

> **Project status:** early MVP scaffold. AI suggestions are not guaranteed to be correct. The initial verifier performs static Python syntax checks only; it does not claim arbitrary code was safely executed or that a patch is behaviorally correct.

## Planned features

- **Debug:** submit source code and an optional error message; receive an explanation and proposed patch.
- **CodeTrim:** request a simpler version and compare line/character counts.
- **Verify:** perform safe static Python syntax validation.
- **Local model:** call Ollama's local API at http://localhost:11434 using qwen2.5-coder:1.5b by default.
- **Honest status:** distinguish generated suggestions from static checks; passing syntax validation is not proof of correctness.

## Architecture

~~~text
Browser / API client
        |
        v
FastAPI backend (this repository)
        |
        v
Ollama local HTTP API
        |
        v
qwen2.5-coder:1.5b
~~~

The frontend should call the FastAPI backend, not Ollama directly. A hosted backend cannot automatically access Ollama running on your personal computer; the first version is intended for local development.

## Requirements

- Windows 10/11, macOS, or Linux
- Python 3.11+
- Ollama: https://ollama.com/download
- A model downloaded in Ollama

## Windows PowerShell setup

~~~powershell
git clone https://github.com/Kraverse/RepoDoctor-AI.git
cd RepoDoctor-AI

python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
pip install -r requirements.txt

Copy-Item .env.example .env
ollama pull qwen2.5-coder:1.5b
ollama list
Invoke-RestMethod -Uri http://localhost:11434/api/tags

uvicorn app.main:app --reload
~~~

If PowerShell blocks virtual-environment activation, use .\.venv\Scripts\python.exe -m pip install -r requirements.txt and .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload.

Open:
- API health: http://127.0.0.1:8000/health
- Interactive API docs: http://127.0.0.1:8000/docs
- Ollama tags: http://localhost:11434/api/tags

## Configuration

Copy `.env.example` to `.env` and adjust as needed. The application loads `.env` automatically when it starts:

- OLLAMA_BASE_URL defaults to http://localhost:11434
- OLLAMA_MODEL defaults to qwen2.5-coder:1.5b
- OLLAMA_TIMEOUT_SECONDS defaults to 120
- MAX_CODE_LENGTH defaults to 20000 characters
- CORS_ORIGINS is a comma-separated list of allowed frontend origins

Do not commit secrets or expose a local Ollama endpoint to the public internet.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /health | API and Ollama connectivity status |
| GET | /api/v1/models | List models visible to Ollama |
| POST | /api/v1/debug | Diagnose code and propose a patch |
| POST | /api/v1/trim | Propose a simplified version and measure size |
| POST | /api/v1/verify | Static Python syntax check; does not execute code |

See [the complete API contract](docs/api-contract.md) or the interactive schema at `/docs` after starting the server. The `/health` response distinguishes API availability, Ollama connectivity, and whether the configured model is installed.

## Example request

~~~powershell
$body = @{
  code = @'
def add(a, b):
    return a - b
'@
  language = "python"
  error_message = "Expected addition, but the function subtracts."
} | ConvertTo-Json

Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/debug -Method Post -ContentType "application/json" -Body $body
~~~

## Testing

~~~powershell
python -m pytest -q
~~~

Tests mock Ollama calls and do not require a running model or paid service.

## Safety and limitations

- Model output is untrusted and may be incorrect.
- The initial verifier parses Python syntax only. It does not execute submitted code.
- Do not paste secrets, credentials, private source code, or sensitive customer data into prompts.
- Do not use this prototype to run arbitrary repositories or install dependencies automatically.
- A passing syntax check does not establish behavioral correctness, security, or global minimality.
- Code reduction percentages compare source text size only; fewer characters are not necessarily better code.
- Keep FastAPI bound to localhost for the local-first workflow. A cloud-hosted backend cannot reach Ollama on your Windows computer through `localhost`; remote access requires a separately secured network design.

## Troubleshooting

- If `http://127.0.0.1:8000/health` reports `ollama: "unavailable"`, make sure the Ollama app/service is running and `OLLAMA_BASE_URL` points to it. On Windows, the Ollama desktop app normally starts the service; `ollama serve` can start it from a terminal if needed.
- If health reports `configured_model_available: false`, run `ollama pull qwen2.5-coder:1.5b`, then check the model name with `ollama list`.
- If the browser cannot reach FastAPI, serve the frontend at `http://localhost:3000` as above (do not open the HTML as a `file://` page) and add its exact origin to `CORS_ORIGINS`.
- If the API is hosted remotely, `http://localhost:11434` refers to the server itself, not your Windows computer. Do not expose Ollama directly to the public internet.

## Roadmap

- [x] Ollama local model integration scaffold
- [x] Debug and trim API endpoints
- [x] Safe static Python syntax validation
- [x] Unit tests with mocked model calls
- [ ] Frontend editor and unified diff viewer
- [ ] AST-aware, language-specific transformations
- [ ] Isolated test runner with explicit resource limits
- [ ] Reproducible benchmark on real bug-fixing tasks
- [ ] CI workflow and release packaging

## License

No license has been selected yet. Until one is added, standard copyright restrictions apply.
