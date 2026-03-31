import type { EnvelopeResponse, AdapterResponse } from './types.js'

function statusIcon(r: AdapterResponse): string {
  return r.status === 'success' ? '✅' : '❌'
}

export function formatMarkdown(envelope: EnvelopeResponse): string {
  const lines: string[] = []
  for (const result of envelope.results) {
    lines.push('━'.repeat(50))
    lines.push(`${statusIcon(result)} [${result.role.toUpperCase()}] ${result.model}  (${result.latency_ms}ms)`)
    lines.push('━'.repeat(50))
    if (result.status === 'success') {
      lines.push(result.content ?? '')
    } else {
      lines.push(`Error [${result.error?.code}]: ${result.error?.message}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function formatJson(envelope: EnvelopeResponse): string {
  return JSON.stringify(envelope, null, 2)
}
