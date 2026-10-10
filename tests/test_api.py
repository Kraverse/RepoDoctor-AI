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
    async def fake_generate(prompt):
        assert "SOURCE:" in prompt
        return "DIAGNOSIS: Wrong operator.\nEXPLANATION: Use addition.\nCODE:\n```python\ndef add(a, b):\n    return a + b\n```"
    monkeypatch.setattr(main_module, "generate", fake_generate)
    response = client.post("/api/v1/debug", json={"code": "def add(a, b):\n    return a - b", "language": "python", "error_message": "Expected addition"})
    assert response.status_code == 200
    body = response.json()
    assert "Wrong operator" in body["diagnosis"]
    assert "return a + b" in body["proposed_code"]
    assert "No tests were executed" in body["warnings"][1]


def test_trim_measures_candidate_size_and_marks_unverified(monkeypatch):
    async def fake_generate(prompt):
        return "Simpler implementation.\nCODE:\n```python\ndef f(x):\n return x\n```"
    monkeypatch.setattr(main_module, "generate", fake_generate)
    response = client.post("/api/v1/trim", json={"code": "def f(x):\n    return x + 0", "language": "python"})
    assert response.status_code == 200
    body = response.json()
    assert body["candidate_code"] == "def f(x):\n return x"
    assert body["status"] == "not_verified"
    assert body["original_characters"] == len(body["original_code"])


def test_model_failure_returns_service_unavailable(monkeypatch):
    async def fail_generate(prompt):
        raise RuntimeError("model offline")
    monkeypatch.setattr(main_module, "generate", fail_generate)
    response = client.post("/api/v1/debug", json={"code": "print('hello')"})
    assert response.status_code == 503
