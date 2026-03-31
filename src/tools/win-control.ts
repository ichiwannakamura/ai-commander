/**
 * AI Commander - Windows基本操作ツール
 *
 * Windows-MCPの基本ツール（App, Click, Type, Shortcut, Scroll, Shell等）を
 * MCPツールとしてClaude Codeに公開する。
 *
 * Claude Codeがこれらのツールを呼び出すと、間接的にWindows-MCPが
 * Windowsデスクトップを操作する仕組み。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WindowsMcpClient } from "../windows/mcp-client.js";

/**
 * Windows基本操作ツールを登録する
 *
 * 以下の3つのMCPツールを登録:
 *   - win_app: アプリケーション起動・切替・リサイズ
 *   - win_action: クリック・タイプ・ショートカット・スクロール
 *   - win_shell: PowerShellコマンド実行
 */
export function registerWinControlTools(
	server: McpServer,
	getClient: () => WindowsMcpClient,
): void {
	// ============================================================
	// win_app: アプリケーション操作
	// ============================================================
	server.tool(
		"win_app",
		"Windowsアプリケーションの起動・切替・リサイズを行う。" +
			"例: Chromeの起動、ウィンドウの切替、サイズ変更など。",
		{
			mode: z
				.enum(["launch", "resize", "switch"])
				.describe("操作モード: launch=起動, resize=サイズ変更, switch=切替"),
			name: z
				.string()
				.optional()
				.describe("アプリ名（launch/switch時。例: Chrome, Notepad）"),
			window_size: z
				.array(z.number())
				.length(2)
				.optional()
				.describe("ウィンドウサイズ [幅, 高さ]（resize時に指定）"),
			window_loc: z
				.array(z.number())
				.length(2)
				.optional()
				.describe("ウィンドウ位置 [x, y]（resize時に指定）"),
		},
		async ({ mode, name, window_size, window_loc }) => {
			const client = getClient();
			const args: Record<string, unknown> = { mode };
			if (name) args.name = name;
			if (window_size) args.window_size = window_size;
			if (window_loc) args.window_loc = window_loc;

			const result = await client.callTool("App", args);
			return {
				content: [
					{
						type: "text" as const,
						text: result.success
							? `✅ アプリ操作成功: ${result.data}`
							: `❌ アプリ操作失敗: ${result.error}`,
					},
				],
			};
		},
	);

	// ============================================================
	// win_action: 画面操作（クリック・タイプ・ショートカット・スクロール）
	// ============================================================
	server.tool(
		"win_action",
		"画面上での操作を実行する。クリック、テキスト入力、キーボードショートカット、スクロールに対応。" +
			"座標はSnapshotで取得した値を使用すること。",
		{
			action: z
				.enum(["click", "type", "shortcut", "scroll"])
				.describe("操作の種類"),
			loc: z
				.array(z.number())
				.length(2)
				.optional()
				.describe("操作位置の座標 [x, y]（click, type, scroll時）"),
			text: z
				.string()
				.optional()
				.describe(
					"入力するテキスト（type時）/ ショートカットキー（shortcut時。例: Ctrl+c, Return）",
				),
			button: z
				.enum(["left", "right", "middle"])
				.optional()
				.default("left")
				.describe("マウスボタン（click時）"),
			clicks: z
				.number()
				.optional()
				.default(1)
				.describe("クリック回数（0=ホバー, 1=シングル, 2=ダブル）"),
			clear: z
				.boolean()
				.optional()
				.default(false)
				.describe("既存テキストをクリアしてから入力（type時）"),
			press_enter: z
				.boolean()
				.optional()
				.default(false)
				.describe("入力後にEnterキーを押す（type時、チャット送信に便利）"),
			direction: z
				.enum(["up", "down", "left", "right"])
				.optional()
				.default("down")
				.describe("スクロール方向（scroll時）"),
			wheel_times: z
				.number()
				.optional()
				.default(3)
				.describe("スクロール回数（scroll時）"),
		},
		async ({
			action,
			loc,
			text,
			button,
			clicks,
			clear,
			press_enter,
			direction,
			wheel_times,
		}) => {
			const client = getClient();
			let result;

			switch (action) {
				case "click": {
					if (!loc) {
						return {
							content: [
								{
									type: "text" as const,
									text: "❌ clickにはloc（座標）が必要です",
								},
							],
						};
					}
					result = await client.click(
						[loc[0], loc[1]],
						button ?? "left",
						clicks ?? 1,
					);
					break;
				}
				case "type": {
					if (!loc || !text) {
						return {
							content: [
								{
									type: "text" as const,
									text: "❌ typeにはloc（座標）とtext（テキスト）が必要です",
								},
							],
						};
					}
					result = await client.type(
						[loc[0], loc[1]],
						text,
						clear ?? false,
						press_enter ?? false,
					);
					break;
				}
				case "shortcut": {
					if (!text) {
						return {
							content: [
								{
									type: "text" as const,
									text: "❌ shortcutにはtext（キー名。例: Ctrl+c）が必要です",
								},
							],
						};
					}
					result = await client.shortcut(text);
					break;
				}
				case "scroll": {
					if (!loc) {
						return {
							content: [
								{
									type: "text" as const,
									text: "❌ scrollにはloc（座標）が必要です",
								},
							],
						};
					}
					result = await client.scroll(
						[loc[0], loc[1]],
						direction ?? "down",
						wheel_times ?? 3,
					);
					break;
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: result.success
							? `✅ ${action} 実行成功: ${result.data}`
							: `❌ ${action} 実行失敗: ${result.error}`,
					},
				],
			};
		},
	);

	// ============================================================
	// win_shell: PowerShellコマンド実行
	// ============================================================
	server.tool(
		"win_shell",
		"PowerShellコマンドを実行する。ファイル操作、プロセス管理、システム情報取得などに使用。" +
			"危険なコマンドには注意すること。",
		{
			command: z.string().describe("実行するPowerShellコマンド"),
			timeout: z
				.number()
				.optional()
				.default(30)
				.describe("タイムアウト秒数（デフォルト30秒）"),
		},
		async ({ command, timeout }) => {
			const client = getClient();
			const result = await client.shell(command, timeout ?? 30);
			return {
				content: [
					{
						type: "text" as const,
						text: result.success
							? `✅ コマンド実行結果:\n${result.data}`
							: `❌ コマンド実行失敗: ${result.error}`,
					},
				],
			};
		},
	);
}
