import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import dotenv from 'dotenv'

dotenv.config()

export interface RoleConfig {
  ai: string
  model: string
  system?: string
}

export interface AppConfig {
  roles: Record<string, RoleConfig>
  api_keys: Record<string, string>
  timeouts: { global_timeout_s: number; role_timeout_s: number; retries: number }
  mcp: { port: number; host: string }
}

const ENV_VAR_RE = /^\$\{([^}]+)\}$/

export function resolveApiKey(value: string, aiProvider?: string): string {
  // 1. ロール固有環境変数（最優先）
  if (aiProvider) {
    const roleKey = `AICOMMANDER_${aiProvider.toUpperCase()}_API_KEY`
    if (process.env[roleKey]) return process.env[roleKey]!
  }
  // 2. ${ENV_VAR} 参照 → 汎用環境変数
  const match = value.match(ENV_VAR_RE)
  if (match) return process.env[match[1]] ?? ''
  // 3. 空文字（Ollamaなど）はそのまま
  if (value === '') return ''
  // 4. 平文直書き（非推奨）
  console.warn(`[ai-commander] warning: api_keys contains a literal secret. Use \${ENV_VAR} instead.`)
  return value
}

export function loadConfig(rootDir: string): AppConfig {
  const rolesPath = path.join(rootDir, 'roles.yaml')
  const configPath = path.join(rootDir, 'config.yaml')

  if (!fs.existsSync(rolesPath)) throw new Error(`CONFIG_ERROR: roles.yaml not found at ${rolesPath}`)
  if (!fs.existsSync(configPath)) throw new Error(`CONFIG_ERROR: config.yaml not found at ${configPath}`)

  const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as AppConfig
  const roles = (yaml.load(fs.readFileSync(rolesPath, 'utf8')) as { roles: Record<string, RoleConfig> }).roles

  const resolvedKeys: Record<string, string> = {}
  for (const [provider, value] of Object.entries(raw.api_keys ?? {})) {
    resolvedKeys[provider] = resolveApiKey(String(value), provider)
  }

  return {
    roles,
    api_keys: resolvedKeys,
    timeouts: raw.timeouts ?? { global_timeout_s: 30, role_timeout_s: 10, retries: 2 },
    mcp: raw.mcp ?? { port: 3000, host: '127.0.0.1' },
  }
}
