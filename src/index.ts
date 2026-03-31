/**
 * AI Commander - MCPサーバー エントリポイント
 *
 * Claude Code / Claude Desktop / Cursor から MCP を介して
 * Windows操作・他AIチャットの自動化ツールを公開するサーバー。
 *
 * 使い方:
 *   npm run build && npm start
 *
 * Windows-MCPは子プロセスとして自動起動されるため、
 * 手動での起動は不要。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getWindowsMcpConfig } from "./config.js";
import { WindowsMcpClient } from "./windows/mcp-client.js";
import { registerWinControlTools } from "./tools/win-control.js";
import { registerWinSnapshotTools } from "./tools/win-snapshot.js";
import { registerWinAiChatTools } from "./tools/win-ai-chat.js";

/**
 * MCPサーバーの起動処理
 *
 * 起動順序:
 *   1. Windows-MCPクライアントを初期化
 *   2. MCPサーバーを構築し、全ツールを登録
 *   3. StdioTransportで接続を待機（Claude Codeからの接続を受け付ける）
 */
async function main(): Promise<void> {
	console.error("🚀 AI Commander を起動しています...");

	// ============================================================
	// ステップ1: Windows-MCPクライアントの準備
	// ============================================================
	const mcpConfig = getWindowsMcpConfig();
	const windowsClient = new WindowsMcpClient(mcpConfig);

	// Windows-MCPを子プロセスとして起動・接続する
	// 失敗してもサーバーは起動する（ツール呼び出し時に再接続を試みる）
	let initialConnectionSucceeded = false;
	try {
		console.error(
			`⏳ Windows-MCP を子プロセスとして起動中... (${mcpConfig.command} ${mcpConfig.args.join(" ")})`,
		);
		await windowsClient.initialize();
		initialConnectionSucceeded = true;
		console.error(`✅ Windows-MCP 子プロセスの起動・接続に成功しました`);
	} catch (error) {
		console.error(`⚠️  Windows-MCP の起動に失敗しました`);
		console.error(
			`   コマンド: ${mcpConfig.command} ${mcpConfig.args.join(" ")}`,
		);
		console.error(
			`   エラー: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error(`   確認事項:`);
		console.error(`   1. Python 3.13+ がインストールされているか`);
		console.error(`   2. uv がインストールされているか (pip install uv)`);
		console.error(
			`   ※ サーバーは起動を続行します（ツール使用時に再起動を試みます）`,
		);
	}

	/**
	 * Windows-MCPクライアントの遅延取得関数
	 *
	 * ツール呼び出し時にクライアントが未接続なら再接続を試みる。
	 * これにより、Windows-MCPが後から起動された場合でも対応できる。
	 */
	const getClient = (): WindowsMcpClient => {
		if (!windowsClient.isConnected && !initialConnectionSucceeded) {
			// 非同期で再接続を試みる（失敗しても例外は投げない）
			windowsClient.initialize().catch((err) => {
				console.error(
					`再接続失敗: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		}
		return windowsClient;
	};

	// ============================================================
	// ステップ2: MCPサーバーの構築
	// ============================================================
	const server = new McpServer({
		name: "ai-commander",
		version: "1.0.0",
	});

	// 全ツールを登録
	registerWinControlTools(server, getClient);
	registerWinSnapshotTools(server, getClient);
	registerWinAiChatTools(server, getClient);

	console.error("📦 ツール登録完了:");
	console.error("   - win_app         (アプリ操作)");
	console.error("   - win_action      (クリック/タイプ/ショートカット)");
	console.error("   - win_shell       (PowerShell実行)");
	console.error("   - win_snapshot    (画面状態取得)");
	console.error("   - win_scrape      (Webページ取得)");
	console.error("   - win_ai_chat     (🌟 他AIに自動質問)");
	console.error("   - win_ai_services (対応サービス一覧)");

	// ============================================================
	// ステップ3: Stdio Transport で接続待機
	// ============================================================
	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error(
		"🟢 AI Commander が起動しました！Claude Codeからの接続を待機中...",
	);

	// 正常終了時のクリーンアップ
	process.on("SIGINT", async () => {
		console.error("🔴 AI Commander を終了しています...");
		await windowsClient.disconnect();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		console.error("🔴 AI Commander を終了しています...");
		await windowsClient.disconnect();
		process.exit(0);
	});
}

// サーバー起動
main().catch((error) => {
	console.error("💥 致命的エラー:", error);
	process.exit(1);
});
