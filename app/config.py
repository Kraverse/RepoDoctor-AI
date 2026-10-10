"""Environment-based configuration."""
import os

APP_NAME = os.getenv("APP_NAME", "RepoDoctor AI")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:1.5b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
MAX_CODE_CHARS = int(os.getenv("MAX_CODE_CHARS", "20000"))
CORS_ORIGINS = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()]
