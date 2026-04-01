from __future__ import annotations

import os
import sys
import time
from typing import Any

# adapterファイルの絶対パスを基準にsys.pathを設定（CWD非依存）
_ADAPTERS_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTERS_DIR not in sys.path:
    sys.path.insert(0, _ADAPTERS_DIR)

import openai
from base_adapter import BaseAdapter, AdapterRequest, DEFAULT_MAX_TOKENS, make_success_response, make_error_response


class OpenAIAdapter(BaseAdapter):
    def __init__(self) -> None:
        # コネクションプール再利用のためインスタンスをキャッシュ
        self._client = openai.OpenAI()

    def call(self, req: AdapterRequest) -> dict[str, Any]:
        start = time.monotonic()
        try:
            messages: list[dict[str, str]] = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            messages.append({"role": "user", "content": req.prompt})
            response = self._client.chat.completions.create(
                model=req.model,
                messages=messages,
                max_tokens=DEFAULT_MAX_TOKENS,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            content = response.choices[0].message.content or ""
            # usage は streaming 等のエッジケースで None になりうるため防御的に取得
            prompt_tokens = response.usage.prompt_tokens if response.usage else 0
            completion_tokens = response.usage.completion_tokens if response.usage else 0
            return make_success_response(
                req.request_id, req.role, req.model, content,
                prompt_tokens, completion_tokens, elapsed,
            )
        except openai.AuthenticationError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", str(e), elapsed)
        except openai.RateLimitError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "RATE_LIMIT", str(e), elapsed)
        except openai.APIConnectionError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", str(e), elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)


if __name__ == "__main__":
    OpenAIAdapter().run_from_stdin()
