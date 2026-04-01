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
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response

# Docker/WSL環境では OLLAMA_API_URL=http://host.docker.internal:11434/api/chat で上書き可能
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL", "http://127.0.0.1:11434/api/chat")


class OllamaAdapter(BaseAdapter):
    def call(self, req: AdapterRequest) -> dict[str, Any]:
        start = time.monotonic()
        try:
            messages: list[dict[str, str]] = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            messages.append({"role": "user", "content": req.prompt})
            resp = requests.post(
                OLLAMA_API_URL,
                json={"model": req.model, "messages": messages, "stream": False},
                timeout=req.timeout_ms / 1000,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            resp.raise_for_status()
            data = resp.json()
            content = data["message"]["content"]
            # Ollama のトークンキーは prompt_eval_count / eval_count
            return make_success_response(
                req.request_id, req.role, req.model, content,
                data.get("prompt_eval_count", 0), data.get("eval_count", 0), elapsed,
            )
        except requests.Timeout:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "ROLE_TIMEOUT", "Ollama timed out", elapsed)
        except requests.ConnectionError:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", "Ollama unreachable", elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)


if __name__ == "__main__":
    OllamaAdapter().run_from_stdin()
