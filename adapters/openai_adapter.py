import time
import sys
sys.path.insert(0, 'adapters')
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response
import openai

class OpenAIAdapter(BaseAdapter):
    def call(self, req: AdapterRequest):
        start = time.monotonic()
        try:
            client = openai.OpenAI()
            messages = []
            if req.system_prompt:
                messages.append({"role": "system", "content": req.system_prompt})
            messages.append({"role": "user", "content": req.prompt})
            response = client.chat.completions.create(
                model=req.model,
                messages=messages,
                max_tokens=4096,
            )
            elapsed = int((time.monotonic() - start) * 1000)
            content = response.choices[0].message.content or ""
            return make_success_response(
                req.request_id, req.role, req.model, content,
                response.usage.prompt_tokens, response.usage.completion_tokens, elapsed,
            )
        except openai.AuthenticationError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "AUTH_FAILED", str(e), elapsed)
        except openai.RateLimitError as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "RATE_LIMIT", str(e), elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            return make_error_response(req.request_id, req.role, req.model, "MODEL_ERROR", str(e), elapsed)

if __name__ == "__main__":
    OpenAIAdapter().run_from_stdin()
