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

export function buildEnvelope(requestId: string, results: AdapterResponse[]): EnvelopeResponse {
  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length
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
  adapterFile: string,
  req: AdapterRequest,
  roleTimeoutMs: number,
): Promise<AdapterResponse> {
  return new Promise((resolve) => {
    const adapterPath = path.join(adapterDir, adapterFile)
    const proc = spawn('python', [adapterPath], { env: process.env })
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
          error: { code: 'ADAPTER_CRASH', message: stderr || 'Adapter crashed with no output', retriable: false, retry_after_ms: null },
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
  const requestId = randomUUID().replace(/-/g, '').slice(0, 12)

  const tasks = opts.roles.map(async (role) => {
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
      const result = await callAdapter(opts.adapterDir, adapterFile, req, opts.roleTimeoutMs)
      lastResult = result
      if (result.status === 'success') return result
      if (!result.error?.retriable) return result
      if (result.error.retry_after_ms) await new Promise(r => setTimeout(r, result.error!.retry_after_ms!))
    }
    return lastResult!
  })

  // Promise.allSettled で partial success を保証
  const globalTimeout = new Promise<AdapterResponse[]>((resolve) =>
    setTimeout(() => {
      resolve(opts.roles.map(role => ({
        version: PROTOCOL_VERSION, request_id: requestId,
        role: role.roleName, model: role.model, content: null, tokens: null,
        latency_ms: opts.globalTimeoutMs, status: 'error' as const,
        error: { code: 'GLOBAL_TIMEOUT' as const, message: 'Global timeout exceeded', retriable: false, retry_after_ms: null },
      })))
    }, opts.globalTimeoutMs)
  )

  const raceResult = await Promise.race([
    Promise.allSettled(tasks).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : ({
        version: PROTOCOL_VERSION, request_id: requestId,
        role: 'unknown', model: 'unknown', content: null, tokens: null,
        latency_ms: 0, status: 'error' as const,
        error: { code: 'ADAPTER_CRASH' as const, message: String((r as PromiseRejectedResult).reason), retriable: false, retry_after_ms: null },
      }))
    ),
    globalTimeout,
  ])

  return raceResult
}
