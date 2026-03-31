import time
import os
import sys
sys.path.insert(0, 'adapters')
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response
import requests

XAI_API_URL = "https://api.x.ai/v1/chat/completions"

class GrokAdapter(BaseAdapter):
    def call(self, req: AdapterRequest):
        start = time.monotonic()
        try:
            api_key = os.environ.get("XAI_API_KEY", "")
            messages = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            messages.append({"role": "user", "content": req.prompt})
            resp = requests.post(
                XAI_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": req.model, "messages": messages, "max_tokens": 4096},
                timeout=req.timeout_ms / 1000,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            if resp.status_code == 401:
                return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", "Unauthorized", elapsed)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 0)) * 1000
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
        except requests.ConnectionError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", str(e), elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)

if __name__ == "__main__":
    GrokAdapter().run_from_stdin()
