"""FastAPI entry point for RepoDoctor AI."""
import ast
import difflib
import logging
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.config import APP_NAME, CORS_ORIGINS
from app.schemas import CodeRequest, DebugResponse, TrimRequest, TrimResponse, VerifyRequest, VerifyResponse
from app.services.ollama_client import generate, list_models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title=APP_NAME, version="0.1.0", description="Local-first AI debugging and code minimization powered by Ollama.")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


def extract_code(text: str) -> str:
    """Remove a single outer Markdown code fence, if the model included one."""
    match = re.search(r"```(?:[\w.+-]+)?\s*\n(.*?)\n```", text, flags=re.DOTALL)
    return match.group(1).strip("\n") if match else text.strip()


def make_diff(before: str, after: str, language: str) -> str:
    return "\n".join(difflib.unified_diff(before.splitlines(), after.splitlines(), fromfile="original", tofile="proposed", lineterm=""))


@app.get("/")
def root():
    return {"name": APP_NAME, "version": "0.1.0", "docs": "/docs", "health": "/health"}


@app.get("/health")
async def health():
    try:
        models = await list_models()
        return {"status": "ok", "ollama": "connected", "model_count": len(models)}
    except Exception as exc:
        logger.info("Ollama health check failed: %s", exc)
        return {"status": "degraded", "ollama": "unavailable", "detail": "Start Ollama and check OLLAMA_BASE_URL."}


@app.get("/api/v1/models")
async def models():
    try:
        return {"models": await list_models()}
    except Exception as exc:
        logger.warning("Unable to list Ollama models: %s", exc)
        raise HTTPException(status_code=503, detail="Ollama is unavailable. Start Ollama and retry.") from exc


@app.post("/api/v1/debug", response_model=DebugResponse)
async def debug(request: CodeRequest):
    prompt = ("You are a careful code debugging assistant. Analyze the code and optional error. "
              "Return these exact sections: DIAGNOSIS:, EXPLANATION:, CODE:. Under CODE provide the full corrected source inside a fenced code block. "
              "Make the smallest reasonable change, preserve public behavior unless the bug requires otherwise, and do not claim tests were run.\n\n"
              f"Language: {request.language}\nError: {request.error_message or '(not supplied)'}\nSOURCE:\n{request.code}")
    try:
        answer = await generate(prompt)
    except Exception as exc:
        logger.warning("Debug generation failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not reach the local Ollama model. Check that Ollama is running and the configured model is installed.") from exc
    diagnosis = "Model-generated diagnosis; review before applying."
    explanation = answer
    code_match = re.search(r"(?:^|\n)CODE:\s*(.*)", answer, flags=re.DOTALL | re.IGNORECASE)
    if code_match:
        before_code = answer[:code_match.start()].strip()
        dm = re.search(r"DIAGNOSIS:\s*(.*?)(?=\nEXPLANATION:|$)", before_code, flags=re.DOTALL | re.IGNORECASE)
        em = re.search(r"EXPLANATION:\s*(.*)", before_code, flags=re.DOTALL | re.IGNORECASE)
        if dm:
            diagnosis = dm.group(1).strip()
        if em:
            explanation = em.group(1).strip()
        proposed = extract_code(code_match.group(1))
    else:
        proposed = request.code
        explanation = answer
    return DebugResponse(diagnosis=diagnosis, explanation=explanation, proposed_code=proposed, diff=make_diff(request.code, proposed, request.language), warnings=["AI output is a suggestion, not proof of correctness.", "No tests were executed by this endpoint." ])


@app.post("/api/v1/trim", response_model=TrimResponse)
async def trim(request: TrimRequest):
    prompt = ("Simplify the supplied source code while preserving its behavior. Prefer readable, idiomatic code. "
              "Do not claim you ran tests. Output a brief explanation, then a section named CODE: containing the full candidate source in a fenced code block. "
              "If a shorter version would harm readability or behavior, return the original source.\n\n"
              f"Language: {request.language}\nGoal: {request.goal}\nSOURCE:\n{request.code}")
    try:
        answer = await generate(prompt)
    except Exception as exc:
        logger.warning("CodeTrim generation failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not reach the local Ollama model. Check that Ollama is running and the configured model is installed.") from exc
    code_match = re.search(r"(?:^|\n)CODE:\s*(.*)", answer, flags=re.DOTALL | re.IGNORECASE)
    if code_match:
        explanation = answer[:code_match.start()].strip() or "Model proposed a candidate simplification."
        candidate = extract_code(code_match.group(1))
    else:
        explanation = answer
        candidate = request.code
    old_chars, new_chars = len(request.code), len(candidate)
    reduction = round(((old_chars - new_chars) / old_chars) * 100, 2) if old_chars else 0.0
    return TrimResponse(original_lines=len(request.code.splitlines()), candidate_lines=len(candidate.splitlines()), original_characters=old_chars, candidate_characters=new_chars, character_reduction_percent=reduction, original_code=request.code, candidate_code=candidate, explanation=explanation, warnings=["Character reduction is a text-size comparison, not a quality score.", "Behavior has not been verified; review and test the candidate before using it."])


@app.post("/api/v1/verify", response_model=VerifyResponse)
def verify(request: VerifyRequest):
    if request.language.strip().lower() not in {"python", "py"}:
        return VerifyResponse(language=request.language, status="not_supported", message="The initial verifier supports Python syntax checks only. No code was executed.")
    try:
        ast.parse(request.code)
    except SyntaxError as exc:
        return VerifyResponse(language=request.language, status="failed_syntax_check", message=f"Syntax error on line {exc.lineno}: {exc.msg}. No code was executed.")
    return VerifyResponse(language=request.language, status="passed_syntax_check", message="Python syntax parsed successfully. This does not prove runtime behavior or correctness; no code was executed.")
