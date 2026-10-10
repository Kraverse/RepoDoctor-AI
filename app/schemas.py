"""Validated request and response schemas."""
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from app.config import MAX_CODE_LENGTH


class CodeInput(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_LENGTH)

    @field_validator("code")
    @classmethod
    def code_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Code must contain at least one non-whitespace character.")
        return value


class CodeRequest(CodeInput):
    language: str = Field(default="python", min_length=1, max_length=40)
    error_message: str = Field(default="", max_length=8000)


class TrimRequest(CodeInput):
    language: str = Field(default="python", min_length=1, max_length=40)
    goal: str = Field(default="Simplify the code without changing its behavior.", max_length=2000)


class VerifyRequest(CodeInput):
    language: str = Field(default="python", min_length=1, max_length=40)


class DebugResponse(BaseModel):
    diagnosis: str
    explanation: str
    assumptions: str = ""
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
    diff: str
    warnings: list[str]
    status: Literal["not_verified"] = "not_verified"


class VerifyResponse(BaseModel):
    language: str
    status: Literal["passed_syntax_check", "failed_syntax_check", "not_supported"]
    message: str
