from __future__ import annotations

import os
import sys
import time
from typing import Any

# adapterファイルの絶対パスを基準にsys.pathを設定（CWD非依存）
_ADAPTERS_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTERS_DIR not in sys.path:
    sys.path.insert(0, _ADAPTERS_DIR)

import requests
from base_adapter import BaseAdapter, AdapterRequest, DEFAULT_MAX_TOKENS, make_success_response, make_error_response

XAI_API_URL = "https://api.x.ai/v1/chat/completions"


class GrokAdapter(BaseAdapter):
    """xAI Grok API アダプター。環境変数 XAI_API_KEY が必要。"""

    def __init__(self) -> None:
        # コネクションプール再利用のためセッションをキャッシュ
        self._session = requests.Session()

    def call(self, req: AdapterRequest) -> dict[str, Any]:
        start = time.monotonic()
        # APIキー未設定を早期リターンで明示（空文字をBearerトークンとして送らない）
        api_key = os.environ.get("XAI_API_KEY")
        if not api_key:
            return make_error_response(
                req.request_id, req.role, req.model,
                "AUTH_FAILED", "XAI_API_KEY is not set", 0,
            )
        try:
            messages: list[dict[str, str]] = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            messages.append({"role": "user", "content": req.prompt})
            resp = self._session.post(
                XAI_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": req.model, "messages": messages, "max_tokens": DEFAULT_MAX_TOKENS},
                timeout=req.timeout_ms / 1000,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            if resp.status_code == 401:
                return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", "Unauthorized", elapsed)
            if resp.status_code == 429:
                # Retry-After は秒数か日付形式で返ることがある。int() 変換失敗時はデフォルト使用
                retry_after_str = resp.headers.get("Retry-After", "0")
                try:
                    retry_after = int(retry_after_str) * 1000
                except ValueError:
                    retry_after = 5000  # 日付形式等、解析不能な場合のフォールバック
                return make_error_response(req.request_id, req.role, req.model, "RATE_LIMIT", "Rate limited", elapsed, retry_after)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            return make_success_response(
                req.request_id, req.role, req.model, content,
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), elapsed,
            )
        except requests.Timeout:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "ROLE_TIMEOUT", "Request timed out", elapsed)
        except requests.ConnectionError:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", "Connection failed", elapsed)
        except (KeyError, ValueError) as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", f"Unexpected response format: {type(e).__name__}", elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)


if __name__ == "__main__":
    GrokAdapter().run_from_stdin()
