from __future__ import annotations

import os
import sys
import time
from typing import Any

# adapterファイルの絶対パスを基準にsys.pathを設定（CWD非依存）
_ADAPTERS_DIR = os.path.dirname(os.path.abspath(__file__))
if _ADAPTERS_DIR not in sys.path:
    sys.path.insert(0, _ADAPTERS_DIR)

import anthropic
from base_adapter import BaseAdapter, AdapterRequest, DEFAULT_MAX_TOKENS, make_success_response, make_error_response


class ClaudeAdapter(BaseAdapter):
    def __init__(self) -> None:
        # コネクションプール再利用のためインスタンスをキャッシュ
        self._client = anthropic.Anthropic()

    def call(self, req: AdapterRequest) -> dict[str, Any]:
        start = time.monotonic()
        try:
            messages = [{"role": "user", "content": req.prompt}]
            response = self._client.messages.create(
                model=req.model,
                max_tokens=DEFAULT_MAX_TOKENS,
                system=req.system_prompt or anthropic.NOT_GIVEN,
                messages=messages,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            # content が空の場合を明示的にハンドル
            if not response.content:
                return make_error_response(
                    req.request_id, req.role, req.model,
                    "MODEL_ERROR", "Empty response from Claude", elapsed,
                )
            content = response.content[0].text
            return make_success_response(
                req.request_id, req.role, req.model, content,
                response.usage.input_tokens, response.usage.output_tokens, elapsed,
            )
        except anthropic.AuthenticationError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", str(e), elapsed)
        except anthropic.RateLimitError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "RATE_LIMIT", str(e), elapsed)
        except anthropic.APIConnectionError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", str(e), elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)


if __name__ == "__main__":
    ClaudeAdapter().run_from_stdin()
