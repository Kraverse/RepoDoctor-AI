"""Validated request and response schemas."""
from typing import Literal
from pydantic import BaseModel, Field
from app.config import MAX_CODE_CHARS

class CodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    language: str = Field(default="python", min_length=1, max_length=40)
    error_message: str = Field(default="", max_length=8000)

class TrimRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    language: str = Field(default="python", min_length=1, max_length=40)
    goal: str = Field(default="Simplify the code without changing its behavior.", max_length=2000)

class VerifyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    language: str = Field(default="python", min_length=1, max_length=40)

class DebugResponse(BaseModel):
    diagnosis: str
    explanation: str
    proposed_code: str
    diff: str
    warnings: list[str]
    status: Literal["suggestion_generated"] = "suggestion_generated"

class TrimResponse(BaseModel):
    original_lines: int
    candidate_lines: int
    original_characters: int
    candidate_characters: int
    character_reduction_percent: float
    original_code: str
    candidate_code: str
    explanation: str
    warnings: list[str]
    status: Literal["not_verified"] = "not_verified"

class VerifyResponse(BaseModel):
    language: str
    status: Literal["passed_syntax_check", "failed_syntax_check", "not_supported"]
    message: str
