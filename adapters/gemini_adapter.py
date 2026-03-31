from __future__ import annotations

import os
import sys
import time
from typing import Any

# adapterファイルの絶対パスを基準にsys.pathを設定（CWD非依存）
_ADAPTERS_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTERS_DIR not in sys.path:
    sys.path.insert(0, _ADAPTERS_DIR)

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response


class GeminiAdapter(BaseAdapter):
    def __init__(self) -> None:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        # configure はインスタンス生成時に1回だけ呼ぶ（グローバル状態競合を防止）
        genai.configure(api_key=api_key)

    def call(self, req: AdapterRequest) -> dict[str, Any]:
        start = time.monotonic()
        try:
            model = genai.GenerativeModel(
                model_name=req.model,
                system_instruction=req.system_prompt or None,
            )
            response = model.generate_content(req.prompt)
            elapsed = int((time.monotonic() - start) * 1000)
            # safety フィルターで candidates が空の場合 response.text は ValueError を投げる
            if not response.candidates:
                return make_error_response(
                    req.request_id, req.role, req.model,
                    "MODEL_ERROR", "Response blocked by safety filter", elapsed,
                )
            content = response.text
            usage = response.usage_metadata
            # 途中停止時は candidates_token_count が None になりうる
            prompt_tokens = usage.prompt_token_count or 0
            candidates_tokens = usage.candidates_token_count or 0
            return make_success_response(
                req.request_id, req.role, req.model, content,
                prompt_tokens, candidates_tokens, elapsed,
            )
        except google_exceptions.Unauthenticated as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", str(e), elapsed)
        except google_exceptions.ResourceExhausted as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "RATE_LIMIT", str(e), elapsed)
        except google_exceptions.ServiceUnavailable as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", str(e), elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)


if __name__ == "__main__":
    GeminiAdapter().run_from_stdin()
