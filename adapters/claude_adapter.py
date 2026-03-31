import time
import sys
sys.path.insert(0, 'adapters')
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response
import anthropic

class ClaudeAdapter(BaseAdapter):
    def call(self, req: AdapterRequest):
        start = time.monotonic()
        try:
            client = anthropic.Anthropic()
            messages = [{"role": "user", "content": req.prompt}]
            response = client.messages.create(
                model=req.model,
                max_tokens=4096,
                system=req.system_prompt or anthropic.NOT_GIVEN,
                messages=messages,
            )
            elapsed = int((time.monotonic() - start) * 1000)
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
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)

if __name__ == "__main__":
    ClaudeAdapter().run_from_stdin()
