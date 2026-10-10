"""Configuration tests exercise .env loading without touching the working tree's settings."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def test_dotenv_loads_settings_and_process_environment_takes_precedence(tmp_path):
    project = tmp_path / "fixture"
    app_dir = project / "app"
    app_dir.mkdir(parents=True)
    source_config = Path(__file__).parents[1] / "app" / "config.py"
    shutil.copyfile(source_config, app_dir / "config.py")
    (app_dir / "__init__.py").write_text("", encoding="utf-8")
    (project / ".env").write_text(
        "APP_NAME=Loaded from dotenv\n"
        "OLLAMA_MODEL=dotenv-model:latest\n"
        "CORS_ORIGINS=https://one.example/, https://two.example\n",
        encoding="utf-8",
    )

    env = os.environ.copy()
    for name in ("APP_NAME", "OLLAMA_MODEL", "CORS_ORIGINS"):
        env.pop(name, None)
    env["APP_NAME"] = "Process environment wins"
    script = (
        "import json; from app.config import APP_NAME, OLLAMA_MODEL, CORS_ORIGINS; "
        "print(json.dumps({'app': APP_NAME, 'model': OLLAMA_MODEL, 'origins': CORS_ORIGINS}))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=project,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    config = json.loads(result.stdout)
    assert config["app"] == "Process environment wins"
    assert config["model"] == "dotenv-model:latest"
    assert config["origins"] == ["https://one.example", "https://two.example"]
