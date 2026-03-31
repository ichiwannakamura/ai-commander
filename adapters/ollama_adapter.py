import time
import sys
sys.path.insert(0, 'adapters')
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response
import requests

OLLAMA_API_URL = "http://127.0.0.1:11434/api/chat"

class OllamaAdapter(BaseAdapter):
    def call(self, req: AdapterRequest):
        start = time.monotonic()
        try:
            messages = []
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
            usage = data.get("usage", {})
            return make_success_response(
                req.request_id, req.role, req.model, content,
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), elapsed,
            )
        except requests.Timeout:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "ROLE_TIMEOUT", "Ollama timed out", elapsed)
        except requests.ConnectionError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "NETWORK_ERROR", f"Ollama unreachable: {e}", elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)

if __name__ == "__main__":
    OllamaAdapter().run_from_stdin()
