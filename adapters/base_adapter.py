from __future__ import annotations

import json
import os
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

# adapterファイルの絶対パスを基準にsys.pathを設定（CWD非依存）
_ADAPTERS_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTERS_DIR not in sys.path:
    sys.path.insert(0, _ADAPTERS_DIR)

RETRIABLE_CODES = {"ROLE_TIMEOUT", "RATE_LIMIT", "MODEL_ERROR", "NETWORK_ERROR"}

# 全アダプター共通のデフォルト最大トークン数（変更時はここだけ修正）
DEFAULT_MAX_TOKENS = 4096

# エラーメッセージに含まれうる機密情報をサニタイズ
_SENSITIVE_PATTERNS = ("key", "token", "secret", "password", "auth", "bearer")


def _sanitize_message(msg: str) -> str:
    """エラーメッセージから機密情報を含む可能性のある長い文字列を除去する。"""
    lower = msg.lower()
    for pattern in _SENSITIVE_PATTERNS:
        if pattern in lower:
            return "Authentication or credential error (details hidden)"
    # URL を含む場合は接続先ホストのみに切り詰め
    if "http" in lower or "://" in lower:
        return "Connection error (URL details hidden)"
    return msg[:300] if len(msg) > 300 else msg


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
        # 必須フィールド欠落は KeyError → INVALID_PROMPT として上位で処理
        prompt = data["prompt"]
        model = data["model"]
        if len(prompt) > 100_000:
            raise ValueError("prompt exceeds 100,000 character limit")
        if len(model) > 200:
            raise ValueError("model name exceeds 200 character limit")
        return cls(
            version=data["version"],
            request_id=data["request_id"],
            role=data["role"],
            model=model,
            prompt=prompt,
            system_prompt=data.get("system_prompt", ""),
            timeout_ms=data.get("timeout_ms", 10000),
        )


def make_error_response(
    request_id: str,
    role: str,
    model: str,
    code: str,
    message: str,
    latency_ms: int,
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
            "message": _sanitize_message(message),
            "retriable": code in RETRIABLE_CODES,
            "retry_after_ms": retry_after_ms,
        },
    }


def make_success_response(
    request_id: str,
    role: str,
    model: str,
    content: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
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


class BaseAdapter(ABC):
    """全アダプターの基底クラス。run_from_stdin() で stdin JSON → stdout JSON。"""

    @abstractmethod
    def call(self, req: AdapterRequest) -> dict[str, Any]:
        """AIを呼び出し、make_success_response / make_error_response の結果を返す。"""

    def run_from_stdin(self) -> None:
        raw = sys.stdin.read()
        start = time.monotonic()
        request_id = "unknown"
        role = "unknown"
        model = "unknown"
        try:
            req = AdapterRequest.from_json(raw)
            request_id, role, model = req.request_id, req.role, req.model
            result = self.call(req)
        except (json.JSONDecodeError, KeyError, ValueError):
            # 内部例外メッセージをそのまま返すとスキーマ構造が露出するため固定メッセージを使用
            result = make_error_response(request_id, role, model, "INVALID_PROMPT", "Invalid or malformed request", 0)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            result = make_error_response(request_id, role, model, "ADAPTER_CRASH", str(e), elapsed)
        print(json.dumps(result), flush=True)
