from __future__ import annotations
import json
import sys
import time
from dataclasses import dataclass
from typing import Any

RETRIABLE_CODES = {"ROLE_TIMEOUT", "RATE_LIMIT", "MODEL_ERROR", "NETWORK_ERROR"}


@dataclass
class AdapterRequest:
    version: str
    request_id: str
    role: str
    model: str
    prompt: str
    system_prompt: str
    timeout_ms: int

    @classmethod
    def from_json(cls, raw: str) -> "AdapterRequest":
        data = json.loads(raw)
        return cls(
            version=data["version"],
            request_id=data["request_id"],
            role=data["role"],
            model=data["model"],
            prompt=data["prompt"],
            system_prompt=data.get("system_prompt", ""),
            timeout_ms=data.get("timeout_ms", 10000),
        )


def make_error_response(
    request_id: str, role: str, model: str,
    code: str, message: str, latency_ms: int,
    retry_after_ms: int | None = None,
) -> dict[str, Any]:
    return {
        "version": "1",
        "request_id": request_id,
        "role": role,
        "model": model,
        "content": None,
        "tokens": None,
        "latency_ms": latency_ms,
        "status": "error",
        "error": {
            "code": code,
            "message": message,
            "retriable": code in RETRIABLE_CODES,
            "retry_after_ms": retry_after_ms,
        },
    }


def make_success_response(
    request_id: str, role: str, model: str,
    content: str, input_tokens: int, output_tokens: int, latency_ms: int,
) -> dict[str, Any]:
    return {
        "version": "1",
        "request_id": request_id,
        "role": role,
        "model": model,
        "content": content,
        "tokens": {"input": input_tokens, "output": output_tokens},
        "latency_ms": latency_ms,
        "status": "success",
    }


class BaseAdapter:
    """全アダプターの基底クラス。run_from_stdin() でstdin JSON → stdout JSON"""

    def call(self, req: AdapterRequest) -> dict[str, Any]:
        raise NotImplementedError

    def run_from_stdin(self) -> None:
        raw = sys.stdin.read()
        start = time.monotonic()
        try:
            req = AdapterRequest.from_json(raw)
            result = self.call(req)
        except json.JSONDecodeError as e:
            result = make_error_response("unknown", "unknown", "unknown", "INVALID_PROMPT", str(e), 0)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            result = make_error_response("unknown", "unknown", "unknown", "ADAPTER_CRASH", str(e), elapsed)
        print(json.dumps(result), flush=True)
