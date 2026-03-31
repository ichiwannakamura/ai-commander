import time
import os
import sys
sys.path.insert(0, 'adapters')
from base_adapter import BaseAdapter, AdapterRequest, make_success_response, make_error_response
import google.generativeai as genai

class GeminiAdapter(BaseAdapter):
    def call(self, req: AdapterRequest):
        start = time.monotonic()
        try:
            genai.configure(api_key=os.environ["GEMINI_API_KEY"])
            model = genai.GenerativeModel(
                model_name=req.model,
                system_instruction=req.system_prompt or None,
            )
            response = model.generate_content(req.prompt)
            elapsed = int((time.monotonic() - start) * 1000)
            content = response.text
            usage = response.usage_metadata
            return make_success_response(
                req.request_id, req.role, req.model, content,
                usage.prompt_token_count, usage.candidates_token_count, elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            code = "AUTH_FAILED" if "API_KEY" in str(e).upper() else "MODEL_ERROR"
            return make_error_response(req.request_id, req.role, req.model, code, str(e), elapsed)

if __name__ == "__main__":
    GeminiAdapter().run_from_stdin()
