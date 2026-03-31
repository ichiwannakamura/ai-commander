/**
 * AI Commander - 🌟 他AIへの自動質問ツール（目玉機能）
 *
 * Claude CodeからChatGPT、Grok等のWebベースAIサービスに
 * 自動的に質問を送り、回答を取得するMCPツール。
 *
 * 使用例（Claude Codeでの指示）:
 *   「ChatGPTに量子コンピュータについて聞いてきて」
 *   「GrokにPythonのソートアルゴリズムを質問して」
 *   「GeminiとChatGPTの両方に同じ質問をして比較して」
 *
 * 前提条件:
 *   対象のAIサービスにブラウザでログイン済みであること。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserAutomation } from "../windows/browser-automation.js";
import { WEB_AI_SERVICES, isValidWebAiService } from "../config.js";
import { WEB_AI_SERVICE_NAMES } from "../types.js";
import type { WindowsMcpClient } from "../windows/mcp-client.js";

/**
 * WebベースAIチャットツールを登録する
 *
 * 以下の2つのMCPツールを登録:
 *   - win_ai_chat: 他AIサービスに質問を送り回答を取得（全自動）
 *   - win_ai_services: 対応するAIサービスの一覧を表示
 */
export function registerWinAiChatTools(
	server: McpServer,
	getClient: () => WindowsMcpClient,
): void {
	// ============================================================
	// win_ai_chat: 🌟 他AIに自動質問
	// ============================================================
	server.tool(
		"win_ai_chat",
		"🌟 WebベースAIサービス（ChatGPT, Grok, Gemini, Copilot）に自動的に質問を送り、回答を取得する。\n" +
			"ブラウザを操作して質問を入力→送信→回答を取得する全工程を自動実行する。\n" +
			"事前にブラウザで対象サービスにログイン済みであること。\n\n" +
			"対応サービス: chatgpt, grok, gemini-web, copilot",
		{
			service: z
				.string()
				.describe(
					"使用するAIサービス名。chatgpt / grok / gemini-web / copilot",
				),
			question: z.string().describe("AIに送信する質問テキスト"),
		},
		async ({ service, question }) => {
			// サービス名のバリデーション
			if (!isValidWebAiService(service)) {
				const validNames = WEB_AI_SERVICE_NAMES.join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text:
								`❌ 未対応のサービス名: "${service}"\n` +
								`対応サービス: ${validNames}\n\n` +
								`使用例: service="chatgpt", question="量子コンピュータとは？"`,
						},
					],
				};
			}

			const client = getClient();
			const automation = new BrowserAutomation(client);
			const serviceConfig = WEB_AI_SERVICES[service];

			// 実行開始を報告
			const startMessage =
				`🚀 ${serviceConfig.displayName} に質問を送信中...\n` +
				`📝 質問: ${question}\n` +
				`⏳ 応答を待機します...`;

			console.error(startMessage);

			// WebベースAIに質問を送って回答を取得
			const result = await automation.askWebAi(service, question);

			if (result.success) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`✅ ${serviceConfig.displayName} からの回答を取得しました！\n\n` +
								`📝 質問: ${result.question}\n` +
								`⏱️ 所要時間: ${result.elapsedSeconds.toFixed(1)}秒\n\n` +
								`📋 回答:\n${result.answer}`,
						},
					],
				};
			}

			// 失敗時のエラーレポート
			return {
				content: [
					{
						type: "text" as const,
						text:
							`❌ ${serviceConfig.displayName} への質問に失敗しました\n\n` +
							`📝 質問: ${result.question}\n` +
							`⏱️ 経過時間: ${result.elapsedSeconds.toFixed(1)}秒\n` +
							`🔍 エラー: ${result.error}\n\n` +
							`💡 対処法:\n` +
							`  1. ブラウザで ${serviceConfig.url} にログイン済みか確認\n` +
							`  2. Windows-MCPが起動しているか確認\n` +
							`  3. win_snapshot で画面状態を確認してから手動操作を試す`,
					},
				],
			};
		},
	);

	// ============================================================
	// win_ai_services: 対応サービス一覧
	// ============================================================
	server.tool(
		"win_ai_services",
		"AI Commanderが対応するWebベースAIサービスの一覧を表示する。",
		{},
		async () => {
			const lines: string[] = [
				"🌟 対応WebベースAIサービス一覧",
				"================================",
				"",
			];

			for (const [key, config] of Object.entries(WEB_AI_SERVICES)) {
				lines.push(`📌 ${config.displayName}`);
				lines.push(`   サービス名: ${key}`);
				lines.push(`   URL: ${config.url}`);
				lines.push("");
			}

			lines.push("使い方:");
			lines.push(
				'  win_ai_chat を使って service="chatgpt", question="質問内容" のように呼び出してください。',
			);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
