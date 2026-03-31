import { Command } from 'commander'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from './config-loader.js'
import { resolveRoles, autoDetectRole } from './orchestrator.js'
import { dispatch, buildEnvelope } from './dispatcher.js'
import { formatMarkdown, formatJson } from './aggregator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const ADAPTER_DIR = path.join(ROOT_DIR, 'adapters')

const program = new Command()
program.name('ai-cmd').description('Multi-AI orchestrator CLI').version('0.1.0')

// === メイン実行コマンド ===
program
  .argument('[prompt]', 'Prompt to send')
  .option('--role <roles>', 'Comma-separated role names (e.g. coder,reviewer)')
  .option('--timeout <seconds>', 'Global timeout in seconds', '30')
  .option('--role-timeout <seconds>', 'Per-role timeout in seconds', '10')
  .option('--json', 'Output as JSON envelope')
  .option('--stream', 'Stream output (mutually exclusive with --json)')
  .option('--dry-run', 'Show routing plan without executing')
  .action(async (prompt: string | undefined, opts) => {
    if (opts.json && opts.stream) {
      console.error('error: --stream and --json are mutually exclusive')
      process.exit(1)
    }
    if (!prompt) { program.help(); return }

    const config = loadConfig(ROOT_DIR)
    const roleNames = opts.role
      ? opts.role.split(',').map((r: string) => r.trim())
      : [autoDetectRole(prompt, config)]
    const resolvedRoles = resolveRoles(roleNames, config)

    if (opts.dryRun) {
      const globalTimeout = parseInt(opts.timeout) * 1000
      const roleTimeout = parseInt(opts.roleTimeout) * 1000
      for (const role of resolvedRoles) {
        console.log(`role: ${role.roleName}`)
        console.log(`  adapter: adapters/${role.ai}_adapter.py`)
        console.log(`  model: ${role.model}`)
        console.log(`  system_prompt: "${role.system.slice(0, 60)}..."`)
        console.log(`  timeout: ${roleTimeout / 1000}s (role) / ${globalTimeout / 1000}s (global)`)
        console.log(`  retries: ${config.timeouts.retries}`)
      }
      console.log('→ dry-run: no request sent')
      return
    }

    const results = await dispatch({
      adapterDir: ADAPTER_DIR,
      prompt,
      roles: resolvedRoles,
      apiKeys: config.api_keys,
      roleTimeoutMs: parseInt(opts.roleTimeout) * 1000,
      globalTimeoutMs: parseInt(opts.timeout) * 1000,
      retries: config.timeouts.retries,
    })
    const envelope = buildEnvelope(results[0]?.request_id ?? 'unknown', results)

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
  const config = loadConfig(ROOT_DIR)
  for (const [name, role] of Object.entries(config.roles)) {
    console.log(`  ${name.padEnd(15)} ${role.ai.padEnd(10)} ${role.model}`)
  }
})

roles.command('show <role>').action((roleName: string) => {
  const config = loadConfig(ROOT_DIR)
  const role = config.roles[roleName]
  if (!role) { console.error(`Role "${roleName}" not found`); process.exit(1) }
  console.log(JSON.stringify({ name: roleName, ...role }, null, 2))
})

roles.command('validate <role>').action(async (roleName: string) => {
  const config = loadConfig(ROOT_DIR)
  const role = config.roles[roleName]
  if (!role) { console.error(`CONFIG_ERROR: role "${roleName}" not found`); process.exit(1) }

  const ai = role.ai
  const apiKey = config.api_keys[ai]

  // [1/3] APIキー存在確認
  if (!apiKey) {
    console.log(`[1/3] APIキー存在確認     ❌ No key for provider "${ai}"`)
    process.exit(1)
  }
  console.log(`[1/3] APIキー存在確認     ✅ key found (non-empty)`)

  // [2/3] + [3/3]: 最小トークン疎通
  const results = await dispatch({
    adapterDir: ADAPTER_DIR, prompt: 'Say "ok" in one word.',
    roles: [{ roleName, ai: role.ai, model: role.model, system: '' }],
    apiKeys: config.api_keys, roleTimeoutMs: 15000, globalTimeoutMs: 20000, retries: 0,
  })
  const result = results[0]
  if (result.status === 'success' && result.content && result.tokens) {
    console.log(`[2/3] エンドポイント疎通  ✅ HTTP 200 reachable (${result.latency_ms}ms)`)
    console.log(`[3/3] 最小トークン疎通    ✅ response non-empty + usage present (${result.tokens.input + result.tokens.output} tokens)`)
    console.log(`✅ role "${roleName}" is valid`)
  } else {
    console.log(`[2/3] エンドポイント疎通  ❌ ${result.error?.code}: ${result.error?.message}`)
    process.exit(1)
  }
})

// === doctor コマンド ===
program.command('doctor').action(async () => {
  const fs = await import('fs')
  const net = await import('net')
  const config = loadConfig(ROOT_DIR)
  const sep = '─'.repeat(45)

  console.log(sep)
  console.log(`✅ config.yaml          found`)
  console.log(`✅ roles.yaml           ${Object.keys(config.roles).length} roles`)
  console.log(sep)

  for (const [ai, adapterFile] of Object.entries({
    claude: 'claude_adapter.py', openai: 'openai_adapter.py',
    gemini: 'gemini_adapter.py', grok: 'grok_adapter.py', ollama: 'ollama_adapter.py',
  })) {
    const exists = fs.existsSync(path.join(ADAPTER_DIR, adapterFile))
    const apiKey = config.api_keys[ai]
    if (!exists) { console.log(`❌ ${adapterFile.padEnd(25)} file not found`); continue }
    if (!apiKey && ai !== 'ollama') { console.log(`⚠️  ${adapterFile.padEnd(25)} no API key`); continue }
    console.log(`✅ ${adapterFile.padEnd(25)} OK`)
  }

  console.log(sep)
  const { port, host } = config.mcp
  const isListening = await new Promise<boolean>(resolve => {
    const sock = net.createConnection(port, host)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
  })
  if (isListening) {
    console.log(`✅ MCP server           listening on :${port}`)
  } else {
    console.log(`🔴 MCP server           not running`)
    console.log(`                        → 起動: ai-cmd serve`)
  }
})

// === serve コマンド ===
program.command('serve').action(async () => {
  const { startMcpServer } = await import('./mcp-server.js')
  const config = loadConfig(ROOT_DIR)
  await startMcpServer(config, ADAPTER_DIR)
})

program.parse()
