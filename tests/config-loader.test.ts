import { describe, it, expect, beforeEach } from 'vitest'
import { resolveApiKey } from '../src/config-loader.js'

describe('resolveApiKey', () => {
  beforeEach(() => {
    process.env['TEST_API_KEY'] = 'sk-test-123'
    delete process.env['AICOMMANDER_TEST_API_KEY']
  })

  it('resolves ${ENV_VAR} syntax to env value', () => {
    expect(resolveApiKey('${TEST_API_KEY}')).toBe('sk-test-123')
  })

  it('returns empty string as-is', () => {
    expect(resolveApiKey('')).toBe('')
  })

  it('throws CONFIG_ERROR for literal secrets', () => {
    expect(() => resolveApiKey('sk-literal')).toThrow('CONFIG_ERROR')
  })

  it('role-specific env takes priority', () => {
    process.env['AICOMMANDER_TEST_API_KEY'] = 'sk-role-specific'
    expect(resolveApiKey('${TEST_API_KEY}', 'test')).toBe('sk-role-specific')
  })
})
