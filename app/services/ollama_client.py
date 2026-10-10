"""Minimal async client for the local Ollama generate endpoint."""
import httpx
from app.config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS


async def generate(prompt: str, system: str | None = None) -> str:
    payload = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    if system:
        payload["system"] = system
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Ollama returned an invalid response.")
    answer = data.get("response")
    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("Ollama returned an empty response.")
    return answer.strip()


async def list_models() -> list[dict]:
    async with httpx.AsyncClient(timeout=min(10.0, OLLAMA_TIMEOUT_SECONDS)) as client:
        response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, dict) or not isinstance(data.get("models"), list):
        raise RuntimeError("Ollama returned an invalid model list.")
    if any(
        not isinstance(model, dict)
        or not any(isinstance(model.get(key), str) for key in ("name", "model"))
        for model in data["models"]
    ):
        raise RuntimeError("Ollama returned an invalid model list.")
    return data["models"]
