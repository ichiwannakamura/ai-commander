/**
 * AI Commander - プロトコル型定義
 *
 * TypeScript(司令塔) ↔ Python(AIアダプター) 間の
 * 通信プロトコルを型安全に定義する。
 */

export const PROTOCOL_VERSION = '1' as const

export type ErrorCode =
  | 'ROLE_TIMEOUT'
  | 'GLOBAL_TIMEOUT'
  | 'AUTH_FAILED'
  | 'RATE_LIMIT'
  | 'MODEL_ERROR'
  | 'ADAPTER_CRASH'
  | 'INVALID_PROMPT'
  | 'NETWORK_ERROR'
  | 'CONFIG_ERROR'

export interface AdapterError {
  code: ErrorCode
  message: string
  retriable: boolean
  retry_after_ms: number | null
}

export interface AdapterRequest {
  version: string
  request_id: string
  role: string
  model: string
  prompt: string
  system_prompt: string
  timeout_ms: number
}

export interface AdapterResponse {
  version: string
  request_id: string
  role: string
  model: string
  content: string | null
  tokens: { input: number; output: number } | null
  latency_ms: number
  status: 'success' | 'error'
  error?: AdapterError
}

export interface EnvelopeSummary {
  total: number
  success: number
  error: number
  total_latency_ms: number
}

export type OverallStatus = 'success' | 'partial_success' | 'error'

export interface EnvelopeResponse {
  version: string
  request_id: string
  overall_status: OverallStatus
  exit_code: 0 | 1 | 2
  summary: EnvelopeSummary
  results: AdapterResponse[]
}

export const RETRIABLE_CODES = new Set<ErrorCode>([
  'ROLE_TIMEOUT',
  'RATE_LIMIT',
  'MODEL_ERROR',
  'NETWORK_ERROR',
])

export function isRetriable(code: ErrorCode): boolean {
  return RETRIABLE_CODES.has(code)
}
