import { describe, it, expect } from 'vitest'
import {
  AdapterRequest,
  AdapterResponse,
  EnvelopeResponse,
  ErrorCode,
} from '../src/types.js'

describe('AdapterRequest', () => {
  it('required fields are present', () => {
    const req: AdapterRequest = {
      version: '1',
      request_id: 'req_test',
      role: 'coder',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
      system_prompt: '',
      timeout_ms: 10000,
    }
    expect(req.version).toBe('1')
    expect(req.request_id).toBe('req_test')
  })
})

describe('EnvelopeResponse overall_status', () => {
  it('all success → overall_status is success', () => {
    const env: EnvelopeResponse = {
      version: '1',
      request_id: 'req_1',
      overall_status: 'success',
      exit_code: 0,
      summary: { total: 1, success: 1, error: 0, total_latency_ms: 500 },
      results: [],
    }
    expect(env.overall_status).toBe('success')
    expect(env.exit_code).toBe(0)
  })
})
