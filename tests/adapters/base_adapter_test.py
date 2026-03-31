import json
import sys
sys.path.insert(0, 'adapters')

from base_adapter import AdapterRequest, make_error_response, RETRIABLE_CODES


def test_adapter_request_parse():
    raw = json.dumps({
        "version": "1", "request_id": "req_1", "role": "coder",
        "model": "test-model", "prompt": "hello", "system_prompt": "",
        "timeout_ms": 5000
    })
    req = AdapterRequest.from_json(raw)
    assert req.request_id == "req_1"
    assert req.timeout_ms == 5000


def test_make_error_response():
    resp = make_error_response("req_1", "coder", "test-model", "ROLE_TIMEOUT", "timed out", 3000)
    assert resp["status"] == "error"
    assert resp["error"]["code"] == "ROLE_TIMEOUT"
    assert resp["error"]["retriable"] is True
    assert resp["error"]["retry_after_ms"] is None


def test_rate_limit_has_retry_after():
    resp = make_error_response("req_1", "coder", "test-model", "RATE_LIMIT", "rate limited", 100, retry_after_ms=5000)
    assert resp["error"]["retry_after_ms"] == 5000


def test_non_retriable_codes():
    for code in ["AUTH_FAILED", "ADAPTER_CRASH", "INVALID_PROMPT", "CONFIG_ERROR", "GLOBAL_TIMEOUT"]:
        resp = make_error_response("req_1", "coder", "test-model", code, "err", 0)
        assert resp["error"]["retriable"] is False, f"{code} should not be retriable"
