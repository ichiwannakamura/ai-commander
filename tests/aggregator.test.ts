import { describe, it, expect } from 'vitest'
import { formatMarkdown, formatJson } from '../src/aggregator.js'
import type { EnvelopeResponse } from '../src/types.js'

const mockEnvelope: EnvelopeResponse = {
  version: '1', request_id: 'r1', overall_status: 'success',
  exit_code: 0, summary: { total: 1, success: 1, error: 0, total_latency_ms: 500 },
  results: [{
    version: '1', request_id: 'r1', role: 'coder', model: 'claude-sonnet-4-6',
    content: 'Here is the code', tokens: { input: 10, output: 20 }, latency_ms: 500, status: 'success',
  }],
}

describe('formatMarkdown', () => {
  it('includes role name and model', () => {
    const md = formatMarkdown(mockEnvelope)
    expect(md).toContain('CODER')
    expect(md).toContain('claude-sonnet-4-6')
    expect(md).toContain('Here is the code')
  })
})

describe('formatJson', () => {
  it('returns valid JSON envelope string', () => {
    const json = formatJson(mockEnvelope)
    const parsed = JSON.parse(json)
    expect(parsed.overall_status).toBe('success')
    expect(parsed.results).toHaveLength(1)
  })
})
