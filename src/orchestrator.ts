import type { AppConfig, RoleConfig } from './config-loader.js'

export interface ResolvedRole {
  roleName: string
  ai: string
  model: string
  system: string
}

export function resolveRoles(roleNames: string[], config: AppConfig): ResolvedRole[] {
  return roleNames.map(name => {
    const role: RoleConfig | undefined = config.roles[name]
    if (!role) throw new Error(`CONFIG_ERROR: role "${name}" not found in roles.yaml`)
    return { roleName: name, ai: role.ai, model: role.model, system: role.system ?? '' }
  })
}

const ROLE_KEYWORDS: Record<string, string[]> = {
  coder: ['code', 'implement', 'write', 'function', 'class', 'bug', 'fix'],
  reviewer: ['review', 'check', 'audit', 'quality', 'issue'],
  monitor: ['log', 'alert', 'monitor', 'status', 'error', 'metrics'],
  researcher: ['search', 'latest', 'news', 'trend', 'find', 'research'],
  planner: ['design', 'architect', 'plan', 'strategy', 'structure'],
}

export function autoDetectRole(prompt: string, config: AppConfig): string {
  const lower = prompt.toLowerCase()
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    if (role in config.roles && keywords.some(k => lower.includes(k))) return role
  }
  // デフォルト: 最初のロール
  return Object.keys(config.roles)[0] ?? 'coder'
}
