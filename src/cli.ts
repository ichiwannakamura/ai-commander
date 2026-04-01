import { Command } from 'commander'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import fs from 'fs'
import { loadConfig } from './config-loader.js'
import { resolveRoles, autoDetectRole } from './orchestrator.js'
import { dispatch, buildEnvelope } from './dispatcher.js'
import { formatMarkdown, formatJson } from './aggregator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const ADAPTER_DIR = path.join(ROOT_DIR, 'adapters')

// provider → 必要な環境変数名
const PROVIDER_ENV_KEYS: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'XAI_API_KEY',
  ollama: '(不要)',
}

/** タイムアウト秒数を検証して秒→msに変換 */
function parseTimeoutSeconds(value: string, name: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 1 || n > 300) {
    console.error(`error: --${name} must be between 1 and 300 seconds (got: ${value})`)
    process.exit(1)
  }
  return n * 1000
}

/** エラーをユーザー向けメッセージで終了 */
function exitWithError(msg: unknown, hint?: string): never {
  const text = msg instanceof Error ? msg.message : String(msg)
  console.error(`error: ${text}`)
  if (hint) console.error(`hint:  ${hint}`)
  process.exit(1)
}

const program = new Command()
program
  .name('ai-cmd')
  .description('Route prompts to multiple AI providers (Claude, OpenAI, Gemini, Grok, Ollama)')
  .version('0.1.0')
  .addHelpText('after', `
Examples:
  $ ai-cmd "このコードをレビューして"
  $ ai-cmd --role coder,reviewer "バグを修正して"
  $ ai-cmd --dry-run --role planner "DBスキーマを設計して"
  $ ai-cmd --json "summarize this" | jq .overall_status
  $ ai-cmd roles list
  $ ai-cmd doctor
  `)

// === メイン実行コマンド ===
program
  .argument('[prompt]', 'Prompt to send')
  .option('--role <roles>', 'Comma-separated role names (e.g. coder,reviewer)')
  .option('--timeout <seconds>', 'Global timeout in seconds', '30')
  .option('--role-timeout <seconds>', 'Per-role timeout in seconds', '20')
  .option('--json', 'Output as JSON envelope')
  .option('--dry-run', 'Show routing plan without executing')
  .action(async (prompt: string | undefined, opts) => {
    if (!prompt) { program.help(); return }

    const globalTimeoutMs = parseTimeoutSeconds(opts.timeout, 'timeout')
    const roleTimeoutMs = parseTimeoutSeconds(opts.roleTimeout, 'role-timeout')

    let config
    try {
      config = loadConfig(ROOT_DIR)
    } catch (e) {
      exitWithError(e, 'Run "ai-cmd doctor" to diagnose configuration issues.')
    }

    const roleNames = opts.role
      ? opts.role.split(',').map((r: string) => r.trim())
      : [autoDetectRole(prompt, config)]

    let resolvedRoles
    try {
      resolvedRoles = resolveRoles(roleNames, config)
    } catch (e) {
      exitWithError(e, 'Run "ai-cmd roles list" to see available roles.')
    }

    if (opts.dryRun) {
      for (const role of resolvedRoles) {
        console.log(`role: ${role.roleName}  (auto-detected from prompt keywords)`)
        console.log(`  adapter: adapters/${role.ai}_adapter.py`)
        console.log(`  model: ${role.model}`)
        if (role.system) console.log(`  system_prompt: "${role.system.slice(0, 60)}..."`)
        console.log(`  timeout: ${roleTimeoutMs / 1000}s (role) / ${globalTimeoutMs / 1000}s (global)`)
        console.log(`  retries: ${config.timeouts.retries}`)
      }
      console.log('\n→ dry-run: no request sent')
      return
    }

    // 処理中フィードバック（--json モードでも stderr に出力するのでパイプを汚さない）
    const roleLabel = resolvedRoles.map(r => r.roleName).join(', ')
    process.stderr.write(`Sending to [${roleLabel}]...\n`)

    const results = await dispatch({
      adapterDir: ADAPTER_DIR,
      prompt,
      roles: resolvedRoles,
      apiKeys: config.api_keys,
      roleTimeoutMs,
      globalTimeoutMs,
      retries: config.timeouts.retries,
    })
    const envelope = buildEnvelope(results)

    if (opts.json) {
      console.log(formatJson(envelope))
    } else {
      console.log(formatMarkdown(envelope))
    }
    process.exit(envelope.exit_code)
  })

// === roles サブコマンド ===
const roles = program.command('roles')

roles.command('list').action(() => {
  let config
  try { config = loadConfig(ROOT_DIR) } catch (e) { exitWithError(e) }
  console.log(`  ${'NAME'.padEnd(15)} ${'PROVIDER'.padEnd(10)} MODEL`)
  console.log(`  ${'-'.repeat(13)} ${'-'.repeat(8)} ${'-'.repeat(25)}`)
  for (const [name, role] of Object.entries(config.roles)) {
    const hasKey = !!config.api_keys[role.ai] || role.ai === 'ollama'
    const status = hasKey ? '[OK]' : '[no key]'
    console.log(`  ${name.padEnd(15)} ${role.ai.padEnd(10)} ${role.model.padEnd(25)} ${status}`)
  }
})

roles.command('show <role>').action((roleName: string) => {
  let config
  try { config = loadConfig(ROOT_DIR) } catch (e) { exitWithError(e) }
  const role = config.roles[roleName]
  if (!role) exitWithError(`Role "${roleName}" not found`, 'Run "ai-cmd roles list" to see available roles.')
  console.log(JSON.stringify({ name: roleName, ...role }, null, 2))
})

roles
  .command('add <name>')
  .description('Add a new role to roles.yaml')
  .requiredOption('--ai <provider>', 'AI provider (claude|openai|gemini|grok|ollama)')
  .requiredOption('--model <model>', 'Model name (e.g. claude-sonnet-4-6)')
  .option('--system <prompt>', 'System prompt for this role')
  .action((name: string, opts) => {
    const VALID_PROVIDERS = ['claude', 'openai', 'gemini', 'grok', 'ollama']
    if (!VALID_PROVIDERS.includes(opts.ai)) {
      exitWithError(`--ai must be one of: ${VALID_PROVIDERS.join(', ')}`)
    }
    const rolesPath = path.join(ROOT_DIR, 'roles.yaml')
    const raw = yaml.load(fs.readFileSync(rolesPath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as { roles: Record<string, unknown> }
    if (name in raw.roles) {
      exitWithError(`Role "${name}" already exists. Use a different name.`)
    }
    raw.roles[name] = { ai: opts.ai, model: opts.model, ...(opts.system ? { system: opts.system } : {}) }
    // 読み込みと同じ JSON_SCHEMA で書き戻す（危険タグの混入防止）
    fs.writeFileSync(rolesPath, yaml.dump(raw, { schema: yaml.JSON_SCHEMA }))
    console.log(`Role "${name}" added (${opts.ai} / ${opts.model})`)
  })

roles.command('validate <role>').action(async (roleName: string) => {
  let config
  try { config = loadConfig(ROOT_DIR) } catch (e) { exitWithError(e) }
  const role = config.roles[roleName]
  if (!role) exitWithError(`Role "${roleName}" not found`, 'Run "ai-cmd roles list" to see available roles.')

  const ai = role.ai
  const apiKey = config.api_keys[ai]
  const sep = '-'.repeat(45)
  console.log(sep)

  // [1/3] APIキー存在確認
  if (!apiKey && ai !== 'ollama') {
    const envKey = PROVIDER_ENV_KEYS[ai] ?? `${ai.toUpperCase()}_API_KEY`
    console.log(`[1/3] API key check       FAIL  No key for provider "${ai}"`)
    console.log(`      Fix: export ${envKey}="your-key-here"`)
    process.exit(1)
  }
  console.log(`[1/3] API key check       OK    key found`)

  // [2/3] + [3/3]: 最小トークン疎通
  const results = await dispatch({
    adapterDir: ADAPTER_DIR, prompt: 'Say "ok" in one word.',
    roles: [{ roleName, ai: role.ai, model: role.model, system: '' }],
    apiKeys: config.api_keys, roleTimeoutMs: 15000, globalTimeoutMs: 20000, retries: 0,
  })
  const result = results[0]
  if (result.status === 'success' && result.content && result.tokens) {
    console.log(`[2/3] Endpoint reachable  OK    HTTP 200 (${result.latency_ms}ms)`)
    console.log(`[3/3] Token round-trip    OK    ${result.tokens.input + result.tokens.output} tokens`)
    console.log(sep)
    console.log(`Role "${roleName}" is valid`)
  } else {
    console.log(`[2/3] Endpoint reachable  FAIL  ${result.error?.code}: ${result.error?.message}`)
    console.log(sep)
    process.exit(1)
  }
})

// === doctor コマンド ===
program.command('doctor').action(async () => {
  const net = await import('net')
  let config
  try { config = loadConfig(ROOT_DIR) } catch (e) { exitWithError(e) }
  const sep = '-'.repeat(45)

  console.log(sep)
  console.log(`OK  config.yaml          found`)
  console.log(`OK  roles.yaml           ${Object.keys(config.roles).length} roles`)
  console.log(sep)

  for (const [ai, adapterFile] of Object.entries({
    claude: 'claude_adapter.py', openai: 'openai_adapter.py',
    gemini: 'gemini_adapter.py', grok: 'grok_adapter.py', ollama: 'ollama_adapter.py',
  })) {
    const exists = fs.existsSync(path.join(ADAPTER_DIR, adapterFile))
    const apiKey = config.api_keys[ai]
    const envKey = PROVIDER_ENV_KEYS[ai] ?? `${ai.toUpperCase()}_API_KEY`
    if (!exists) {
      console.log(`NG  ${adapterFile.padEnd(25)} file not found`)
      continue
    }
    if (!apiKey && ai !== 'ollama') {
      console.log(`!!  ${adapterFile.padEnd(25)} no API key  → Fix: export ${envKey}="your-key"`)
      continue
    }
    console.log(`OK  ${adapterFile.padEnd(25)} ready`)
  }

  console.log(sep)
  const { port, host } = config.mcp
  const isListening = await new Promise<boolean>(resolve => {
    const sock = net.createConnection(port, host)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => { sock.destroy(); resolve(false) })
  })
  if (isListening) {
    console.log(`OK  MCP server           listening on :${port}`)
  } else {
    console.log(`--  MCP server           not running  → Start: ai-cmd serve`)
  }
})

// === serve コマンド ===
program.command('serve').action(async () => {
  const { startMcpServer } = await import('./mcp-server.js')
  let config
  try { config = loadConfig(ROOT_DIR) } catch (e) { exitWithError(e) }
  console.error(`Starting ai-commander MCP server...`)
  await startMcpServer(config, ADAPTER_DIR)
})

program.parse()
