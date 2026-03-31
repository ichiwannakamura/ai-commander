import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import type {
  AdapterRequest, AdapterResponse, EnvelopeResponse,
  OverallStatus,
} from './types.js'
import { PROTOCOL_VERSION } from './types.js'

const ADAPTER_MAP: Record<string, string> = {
  claude: 'claude_adapter.py',
  openai: 'openai_adapter.py',
  gemini: 'gemini_adapter.py',
  grok: 'grok_adapter.py',
  ollama: 'ollama_adapter.py',
}

// アダプターごとに必要な環境変数のみを渡す（最小権限）
const ADAPTER_ENV_KEYS: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'AICOMMANDER_CLAUDE_API_KEY'],
  openai: ['OPENAI_API_KEY', 'AICOMMANDER_OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'AICOMMANDER_GEMINI_API_KEY'],
  grok: ['XAI_API_KEY', 'AICOMMANDER_GROK_API_KEY'],
  ollama: [],
}

function buildAdapterEnv(ai: string): NodeJS.ProcessEnv {
  const allowedKeys = ADAPTER_ENV_KEYS[ai] ?? []
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    PYTHONPATH: process.env['PYTHONPATH'],
    SYSTEMROOT: process.env['SYSTEMROOT'],
  }
  for (const key of allowedKeys) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function sanitizeStderr(stderr: string): string {
  // スタックトレースをそのまま返さず、先頭1行のみに制限
  const firstLine = stderr.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine || 'Adapter crashed with no output'
}

export function buildEnvelope(requestId: string, results: AdapterResponse[]): EnvelopeResponse {
  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length
  // wall-clock latency（並列実行の最長を採用）
  const totalLatency = results.length > 0 ? Math.max(...results.map(r => r.latency_ms)) : 0

  let overall_status: OverallStatus
  let exit_code: 0 | 1 | 2

  if (errorCount === 0) {
    overall_status = 'success'; exit_code = 0
  } else if (successCount === 0) {
    overall_status = 'error'; exit_code = 1
  } else {
    overall_status = 'partial_success'; exit_code = 2
  }

  return {
    version: PROTOCOL_VERSION,
    request_id: requestId,
    overall_status,
    exit_code,
    summary: { total: results.length, success: successCount, error: errorCount, total_latency_ms: totalLatency },
    results,
  }
}

async function callAdapter(
  adapterDir: string,
  ai: string,
  adapterFile: string,
  req: AdapterRequest,
  roleTimeoutMs: number,
): Promise<AdapterResponse> {
  // adapterPath が adapterDir 配下に収まっているか検証（シンボリックリンク脱出防止）
  const adapterPath = path.join(adapterDir, adapterFile)
  const resolvedAdapter = path.resolve(adapterPath)
  const resolvedDir = path.resolve(adapterDir)
  if (!resolvedAdapter.startsWith(resolvedDir + path.sep) && resolvedAdapter !== resolvedDir) {
    return {
      version: PROTOCOL_VERSION,
      request_id: req.request_id,
      role: req.role,
      model: req.model,
      content: null,
      tokens: null,
      latency_ms: 0,
      status: 'error',
      error: { code: 'CONFIG_ERROR', message: 'Adapter path escapes adapter directory', retriable: false, retry_after_ms: null },
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('python', [resolvedAdapter], {
      env: buildAdapterEnv(ai),
      cwd: adapterDir,  // adapterDir をCWDに固定（sys.path の相対解決を安定化）
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill()
      resolve({
        version: PROTOCOL_VERSION,
        request_id: req.request_id,
        role: req.role,
        model: req.model,
        content: null,
        tokens: null,
        latency_ms: roleTimeoutMs,
        status: 'error',
        error: { code: 'ROLE_TIMEOUT', message: `Role timeout exceeded (${roleTimeoutMs}ms)`, retriable: true, retry_after_ms: null },
      })
    }, roleTimeoutMs)

    proc.stdin.write(JSON.stringify(req))
    proc.stdin.end()
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.trim()) as AdapterResponse)
      } catch {
        resolve({
          version: PROTOCOL_VERSION,
          request_id: req.request_id,
          role: req.role,
          model: req.model,
          content: null,
          tokens: null,
          latency_ms: 0,
          status: 'error',
          error: { code: 'ADAPTER_CRASH', message: sanitizeStderr(stderr), retriable: false, retry_after_ms: null },
        })
      }
    })
  })
}

export interface DispatchOptions {
  adapterDir: string
  prompt: string
  roles: Array<{ roleName: string; ai: string; model: string; system: string }>
  apiKeys: Record<string, string>
  roleTimeoutMs: number
  globalTimeoutMs: number
  retries: number
}

export async function dispatch(opts: DispatchOptions): Promise<AdapterResponse[]> {
  const requestId = 'req_' + randomUUID().replace(/-/g, '').slice(0, 10)
  const globalDeadline = Date.now() + opts.globalTimeoutMs

  // 各ロールを並列実行。タスクごとに完了済み結果を保持し global timeout 到達時に差し替える
  const settled = await Promise.allSettled(
    opts.roles.map(async (role) => {
      const adapterFile = ADAPTER_MAP[role.ai]
      if (!adapterFile) {
        return {
          version: PROTOCOL_VERSION, request_id: requestId,
          role: role.roleName, model: role.model, content: null, tokens: null,
          latency_ms: 0, status: 'error' as const,
          error: { code: 'CONFIG_ERROR' as const, message: `Unknown AI provider: ${role.ai}`, retriable: false, retry_after_ms: null },
        }
      }

      const req: AdapterRequest = {
        version: PROTOCOL_VERSION, request_id: requestId,
        role: role.roleName, model: role.model,
        prompt: opts.prompt, system_prompt: role.system,
        timeout_ms: opts.roleTimeoutMs,
      }

      // リトライループ（retriable のみ）
      let lastResult: AdapterResponse | null = null
      for (let attempt = 0; attempt <= opts.retries; attempt++) {
        // global deadline を超えていたら即 GLOBAL_TIMEOUT
        if (Date.now() >= globalDeadline) {
          return {
            version: PROTOCOL_VERSION, request_id: requestId,
            role: role.roleName, model: role.model, content: null, tokens: null,
            latency_ms: opts.globalTimeoutMs, status: 'error' as const,
            error: { code: 'GLOBAL_TIMEOUT' as const, message: 'Global timeout exceeded', retriable: false, retry_after_ms: null },
          }
        }
        const result = await callAdapter(opts.adapterDir, role.ai, adapterFile, req, opts.roleTimeoutMs)
        lastResult = result
        if (result.status === 'success') return result
        if (!result.error?.retriable) return result
        if (result.error.retry_after_ms) await new Promise(r => setTimeout(r, result.error!.retry_after_ms!))
      }
      return lastResult!
    })
  )

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    // Promise 自体が reject した場合（通常は起きないが安全網）
    const role = opts.roles[i]!
    return {
      version: PROTOCOL_VERSION, request_id: requestId,
      role: role.roleName, model: role.model, content: null, tokens: null,
      latency_ms: 0, status: 'error' as const,
      error: { code: 'ADAPTER_CRASH' as const, message: String(r.reason), retriable: false, retry_after_ms: null },
    }
  })
}
