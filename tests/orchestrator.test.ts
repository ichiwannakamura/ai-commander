import { describe, it, expect } from 'vitest'
import { resolveRoles } from '../src/orchestrator.js'
import type { AppConfig } from '../src/config-loader.js'

const mockConfig: AppConfig = {
  roles: {
    coder: { ai: 'claude', model: 'claude-sonnet-4-6', system: 'You are a coder' },
    reviewer: { ai: 'openai', model: 'gpt-4o', system: 'You are a reviewer' },
  },
  api_keys: { claude: 'sk-test', openai: 'sk-test2' },
  timeouts: { global_timeout_s: 30, role_timeout_s: 10, retries: 2 },
  mcp: { port: 3000, host: '127.0.0.1' },
}

describe('resolveRoles', () => {
  it('resolves named roles from config', () => {
    const roles = resolveRoles(['coder'], mockConfig)
    expect(roles).toHaveLength(1)
    expect(roles[0].roleName).toBe('coder')
    expect(roles[0].ai).toBe('claude')
  })

  it('resolves multiple roles', () => {
    const roles = resolveRoles(['coder', 'reviewer'], mockConfig)
    expect(roles).toHaveLength(2)
  })

  it('throws CONFIG_ERROR for unknown role', () => {
    expect(() => resolveRoles(['unknown'], mockConfig)).toThrow('CONFIG_ERROR')
  })
})
