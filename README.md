# RepoDoctor AI

**Local-first AI debugging and code minimization powered by Ollama.**

RepoDoctor AI diagnoses code errors, proposes focused fixes, explores simpler alternatives, and performs static Python syntax checks. AI suggestions can be incorrect; the verifier does not execute code or prove behavior.

## Features

- **AI Debugger:** analyze source and optional error details, then review a proposed patch.
- **CodeTrim:** generate a simpler candidate and compare source size.
- **Code Verifier:** static Python syntax validation only.
- **GitHub Repository Import:** browse a public repository's branches and supported source files, load a file into the editor, and send it to any existing code tool.
- **Local model:** Ollama API at `http://localhost:11434`, using `qwen2.5-coder:1.5b` by default.

## Import a GitHub repository

1. Find **Connect GitHub Repository** near the top of the workbench.
2. Enter a public URL such as `https://github.com/owner/repository` and click **Connect repository**.
3. Select a branch, then click **Load source files**.
4. Select a supported file to load it into the existing editor.
5. Choose **Analyze with Debugger**, **Send to CodeTrim**, or **Check with Verifier**. The selected repository, branch, and file remain visible during the workflow.

The importer uses GitHub's public API and raw file endpoint directly from the browser. No GitHub token is requested, sent, or stored. Private repositories are **not supported** in this version; a secure server-side GitHub OAuth/App flow is required before adding them. Unauthenticated GitHub API rate limits apply. At most 200 supported files are shown; files over 20,000 characters are skipped/rejected. Unsupported/binary files, missing branches/files, very large truncated trees, and API errors produce user-facing messages. Imported code is never executed. Do not import secrets or sensitive source code.

## Architecture

```text
Browser ── GitHub public API/raw source (read-only)
   │
   └── FastAPI backend ── Ollama local HTTP API ── qwen2.5-coder:1.5b
```

The frontend sends AI requests to FastAPI, not directly to Ollama. A hosted backend cannot automatically access Ollama running on a personal computer; the initial AI workflow is intended for local development.

## Requirements

- Windows 10/11, macOS, or Linux
- Python 3.11+
- Node.js 18+ for frontend tests
- Ollama and a downloaded model: https://ollama.com/download

## Windows PowerShell setup

```powershell
git clone https://github.com/Kraverse/RepoDoctor-AI.git
cd RepoDoctor-AI
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
ollama pull qwen2.5-coder:1.5b
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

If activation is blocked, use `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` and `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`.

Open:
- API health: http://127.0.0.1:8000/health
- Interactive API docs: http://127.0.0.1:8000/docs
- Ollama tags: http://localhost:11434/api/tags

### Start the frontend

In a second terminal, from the repository root:

```powershell
python -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Open http://127.0.0.1:5173. FastAPI and Ollama must also be running. The frontend defaults to `http://127.0.0.1:8000`; change the API field to use another backend URL. The frontend has no build step. Run `cd frontend && npm test` and `npm run check` for frontend tests and syntax checks; run `python -m pytest -q` for backend tests.

The default exact-origin CORS allowlist includes local development origins and `https://repodoctor-ai.onrender.com`. If changing the frontend origin, add its exact scheme/host/port to `CORS_ORIGINS` in `.env`. Do not use `*`.

### Deployed frontend and local Ollama

The Render page is served over HTTPS, but `http://127.0.0.1:8000` means the computer running the browser. Start FastAPI on that computer and keep it loopback-bound. CORS alone may not be sufficient: browser mixed-content or local-network permissions can block a hosted HTTPS page from reaching a local HTTP service. For reliable local use, serve the frontend next to FastAPI and Ollama. For a public multi-user service, host FastAPI over HTTPS with authentication, rate limits, and managed inference. Never expose an unauthenticated FastAPI or Ollama port publicly.

## Configuration

The app loads `.env` from the project directory when `app.config` is imported. Process environment variables take precedence. Settings include `APP_NAME`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_SECONDS`, `MAX_CODE_CHARS`, and exact-origin `CORS_ORIGINS`.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /health | API and Ollama connectivity |
| GET | /api/v1/models | Ollama model list |
| POST | /api/v1/debug | Diagnose code and propose a patch |
| POST | /api/v1/trim | Propose simpler code |
| POST | /api/v1/verify | Static Python syntax check; never executes code |

## Tests

```powershell
cd frontend
npm test
npm run check
cd ..
python -m pytest -q
```

Frontend GitHub-import tests mock GitHub responses and do not consume API rate limits. Backend tests mock Ollama.

## Safety and limitations

- Model output is untrusted and may be incorrect.
- The verifier parses Python syntax only; it does not execute code.
- Do not execute or install dependencies from imported repositories automatically.
- Never paste secrets, credentials, private source code, or sensitive customer data into prompts.
- Public GitHub API rate limits apply. Private repositories need a future secure authorization flow.
- Character reduction measures text size, not code quality or behavioral equivalence.

## License

No license has been selected yet. Until one is added, standard copyright restrictions apply.
