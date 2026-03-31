import { describe, it, expect } from 'vitest'
import { buildEnvelope } from '../src/dispatcher.js'
import type { AdapterResponse } from '../src/types.js'

describe('buildEnvelope', () => {
  it('all success → overall_status: success, exit_code: 0', () => {
    const results: AdapterResponse[] = [
      { version: '1', request_id: 'r1', role: 'coder', model: 'm', content: 'ok',
        tokens: { input: 10, output: 20 }, latency_ms: 100, status: 'success' },
    ]
    const env = buildEnvelope(results)
    expect(env.overall_status).toBe('success')
    expect(env.exit_code).toBe(0)
    expect(env.summary.success).toBe(1)
    expect(env.summary.error).toBe(0)
  })

  it('partial → overall_status: partial_success, exit_code: 2', () => {
    const results: AdapterResponse[] = [
      { version: '1', request_id: 'r1', role: 'coder', model: 'm', content: 'ok',
        tokens: null, latency_ms: 100, status: 'success' },
      { version: '1', request_id: 'r1', role: 'reviewer', model: 'm2', content: null,
        tokens: null, latency_ms: 200, status: 'error',
        error: { code: 'ROLE_TIMEOUT', message: 'timeout', retriable: true, retry_after_ms: null } },
    ]
    const env = buildEnvelope(results)
    expect(env.overall_status).toBe('partial_success')
    expect(env.exit_code).toBe(2)
  })

  it('all error → overall_status: error, exit_code: 1', () => {
    const results: AdapterResponse[] = [
      { version: '1', request_id: 'r1', role: 'coder', model: 'm', content: null,
        tokens: null, latency_ms: 100, status: 'error',
        error: { code: 'AUTH_FAILED', message: 'bad key', retriable: false, retry_after_ms: null } },
    ]
    const env = buildEnvelope(results)
    expect(env.overall_status).toBe('error')
    expect(env.exit_code).toBe(1)
  })
})
