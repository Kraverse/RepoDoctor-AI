"""Environment-based configuration."""
import os
from dotenv import load_dotenv

# Load local development settings before reading any configuration values.
load_dotenv()

APP_NAME = os.getenv("APP_NAME", "RepoDoctor AI")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:1.5b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
MAX_CODE_LENGTH = int(os.getenv("MAX_CODE_LENGTH", os.getenv("MAX_CODE_CHARS", "20000")))
# Keep the old setting name available for code that imported it directly.
MAX_CODE_CHARS = MAX_CODE_LENGTH
CORS_ORIGINS = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()]
