import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { AppConfig } from './config-loader.js'
import { resolveRoles, autoDetectRole } from './orchestrator.js'
import { dispatch, buildEnvelope } from './dispatcher.js'
import { formatJson } from './aggregator.js'

export async function startMcpServer(config: AppConfig, adapterDir: string): Promise<void> {
  const server = new McpServer({
    name: 'ai-commander',
    version: '0.1.0',
  })

  // 各ロールをMCPツールとして登録
  for (const [roleName, role] of Object.entries(config.roles)) {
    server.tool(
      roleName,
      { prompt: z.string().describe('The prompt to send to this AI role') },
      async ({ prompt }) => {
        const resolvedRoles = resolveRoles([roleName], config)
        const results = await dispatch({
          adapterDir,
          prompt,
          roles: resolvedRoles,
          apiKeys: config.api_keys,
          roleTimeoutMs: config.timeouts.role_timeout_s * 1000,
          globalTimeoutMs: config.timeouts.global_timeout_s * 1000,
          retries: config.timeouts.retries,
        })
        const envelope = buildEnvelope(results[0]?.request_id ?? 'unknown', results)
        return { content: [{ type: 'text' as const, text: formatJson(envelope) }] }
      }
    )
  }

  // 自動ルーティングツール
  server.tool(
    'auto',
    { prompt: z.string().describe('The prompt — role is auto-detected from content') },
    async ({ prompt }) => {
      const roleName = autoDetectRole(prompt, config)
      const resolvedRoles = resolveRoles([roleName], config)
      const results = await dispatch({
        adapterDir, prompt, roles: resolvedRoles,
        apiKeys: config.api_keys,
        roleTimeoutMs: config.timeouts.role_timeout_s * 1000,
        globalTimeoutMs: config.timeouts.global_timeout_s * 1000,
        retries: config.timeouts.retries,
      })
      const envelope = buildEnvelope(results[0]?.request_id ?? 'unknown', results)
      return { content: [{ type: 'text' as const, text: formatJson(envelope) }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`ai-commander MCP server running (${Object.keys(config.roles).length} roles + auto)`)
}
