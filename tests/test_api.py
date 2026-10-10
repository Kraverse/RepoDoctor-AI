"""API tests use mocked model services; no Ollama server is required."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
import app.main as main_module

client = TestClient(app)


def test_root_has_docs_link():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["docs"] == "/docs"
    assert response.json()["api"] == "/api/v1"


def test_health_reports_api_alive_and_configured_model_available(monkeypatch):
    async def fake_models():
        return [{"name": main_module.OLLAMA_MODEL}]

    monkeypatch.setattr(main_module, "list_models", fake_models)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["api"] == "ok"
    assert body["ollama"] == "connected"
    assert body["configured_model_available"] is True
    assert body["status"] == "ok"


def test_health_degraded_when_configured_model_is_missing(monkeypatch):
    async def fake_models():
        return [{"name": "some-other-model:latest"}]

    monkeypatch.setattr(main_module, "list_models", fake_models)
    body = client.get("/health").json()
    assert body["api"] == "ok"
    assert body["ollama"] == "connected"
    assert body["configured_model_available"] is False
    assert body["status"] == "degraded"


def test_health_degraded_when_ollama_is_unavailable(monkeypatch):
    async def unavailable():
        raise RuntimeError("private transport detail")

    monkeypatch.setattr(main_module, "list_models", unavailable)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["api"] == "ok"
    assert response.json()["ollama"] == "unavailable"
    assert "private transport detail" not in response.text


def test_models_includes_configured_model_availability(monkeypatch):
    async def fake_models():
        return [{"name": main_module.OLLAMA_MODEL}]

    monkeypatch.setattr(main_module, "list_models", fake_models)
    body = client.get("/api/v1/models").json()
    assert body["configured_model"] == main_module.OLLAMA_MODEL
    assert body["configured_model_available"] is True
    assert len(body["models"]) == 1


def test_verify_python_syntax_passes_without_execution():
    response = client.post("/api/v1/verify", json={"code": "def add(a, b):\n    return a + b", "language": "python"})
    assert response.status_code == 200
    assert response.json()["status"] == "passed_syntax_check"
    assert "no code was executed" in response.json()["message"].lower()


def test_verify_python_syntax_error():
    response = client.post("/api/v1/verify", json={"code": "def broken(:\n  pass", "language": "python"})
    assert response.status_code == 200
    assert response.json()["status"] == "failed_syntax_check"


def test_verify_unsupported_language_is_explicit():
    response = client.post("/api/v1/verify", json={"code": "const x = 1", "language": "javascript"})
    assert response.status_code == 200
    assert response.json()["status"] == "not_supported"


def test_debug_uses_mocked_ollama(monkeypatch):
    async def fake_generate(prompt, **kwargs):
        assert '"source_code"' in prompt
        assert kwargs["system"]
        return "DIAGNOSIS: Wrong operator.\nEXPLANATION: Use addition.\nASSUMPTIONS: Addition was intended.\nCODE:\n```python\ndef add(a, b):\n    return a + b\n```"
    monkeypatch.setattr(main_module, "generate", fake_generate)
    response = client.post("/api/v1/debug", json={"code": "def add(a, b):\n    return a - b", "language": "python", "error_message": "Expected addition"})
    assert response.status_code == 200
    body = response.json()
    assert "Wrong operator" in body["diagnosis"]
    assert body["assumptions"] == "Addition was intended."
    assert "return a + b" in body["proposed_code"]
    assert "No tests were executed" in body["warnings"][1]


def test_trim_measures_candidate_size_and_marks_unverified(monkeypatch):
    async def fake_generate(prompt, **kwargs):
        return "Simpler implementation.\nCODE:\n```python\ndef f(x):\n return x\n```"
    monkeypatch.setattr(main_module, "generate", fake_generate)
    response = client.post("/api/v1/trim", json={"code": "def f(x):\n    return x + 0", "language": "python"})
    assert response.status_code == 200
    body = response.json()
    assert body["candidate_code"] == "def f(x):\n return x"
    assert body["status"] == "not_verified"
    assert body["original_characters"] == len(body["original_code"])
    assert body["diff"].startswith("--- original")


def test_malformed_model_output_returns_original_and_warns(monkeypatch):
    async def fake_generate(prompt, **kwargs):
        return "I could not follow the requested format."

    monkeypatch.setattr(main_module, "generate", fake_generate)
    response = client.post("/api/v1/debug", json={"code": "print('safe')"})
    assert response.status_code == 200
    body = response.json()
    assert body["proposed_code"] == "print('safe')"
    assert any("did not include" in warning for warning in body["warnings"])


@pytest.mark.parametrize(
    "payload",
    [
        {"code": ""},
        {"code": "   "},
        {"code": "x" * 20001},
        {"code": 12},
    ],
)
def test_invalid_debug_payloads_are_rejected_without_echoing_input(payload):
    response = client.post("/api/v1/debug", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "Invalid request payload."
    if isinstance(payload.get("code"), str) and len(payload["code"]) > 100:
        assert payload["code"] not in response.text


def test_model_failure_returns_service_unavailable(monkeypatch):
    async def fail_generate(prompt, **kwargs):
        raise RuntimeError("model offline")
    monkeypatch.setattr(main_module, "generate", fail_generate)
    response = client.post("/api/v1/debug", json={"code": "print('hello')"})
    assert response.status_code == 503
    assert "model offline" not in response.text


def test_trim_ollama_failure_returns_safe_service_error(monkeypatch):
    async def fail_generate(prompt, **kwargs):
        raise TimeoutError("private request detail")

    monkeypatch.setattr(main_module, "generate", fail_generate)
    response = client.post("/api/v1/trim", json={"code": "print('hello')"})
    assert response.status_code == 503
    assert "private request detail" not in response.text
