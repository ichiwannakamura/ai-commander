/**
 * AI Commander - 画面スナップショットツール
 *
 * Windows-MCPのSnapshotツールとScrapeツールをラップし、
 * 画面の状態確認・ページ内容取得をMCPツールとして公開する。
 *
 * Claude Codeは:
 *   1. まずwin_snapshotで画面状態を把握
 *   2. 表示された要素の座標を使ってwin_actionで操作
 * という流れで使う。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WindowsMcpClient } from "../windows/mcp-client.js";

/**
 * スナップショット関連ツールを登録する
 *
 * 以下の2つのMCPツールを登録:
 *   - win_snapshot: 画面の状態取得（UIの要素一覧・座標）
 *   - win_scrape: Webページの内容取得（テキスト抽出）
 */
export function registerWinSnapshotTools(
	server: McpServer,
	getClient: () => WindowsMcpClient,
): void {
	// ============================================================
	// win_snapshot: 画面状態の取得
	// ============================================================
	server.tool(
		"win_snapshot",
		"現在のデスクトップ画面の状態を取得する。" +
			"開いているウィンドウ、クリック可能なボタン・リンク、テキスト入力欄、" +
			"それぞれの座標が含まれる。操作の前に必ずこのツールで画面状態を確認すること。\n" +
			"use_dom=true: ブラウザのWebページ要素を詳しく取得（推奨）\n" +
			"use_vision=true: スクリーンショット画像も取得",
		{
			use_dom: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"ブラウザDOM解析モード。Webページの要素を詳しく取得する（ブラウザ操作時はtrue推奨）",
				),
			use_vision: z
				.boolean()
				.optional()
				.default(false)
				.describe("スクリーンショットも含める（画像を確認したい場合にtrue）"),
		},
		async ({ use_dom, use_vision }) => {
			const client = getClient();
			const result = await client.snapshot(
				use_dom ?? false,
				use_vision ?? false,
			);

			if (!result.success) {
				return {
					content: [
						{
							type: "text" as const,
							text: `❌ スナップショット取得失敗: ${result.error}`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `📸 画面スナップショット:\n\n${result.data}`,
					},
				],
			};
		},
	);

	// ============================================================
	// win_scrape: Webページ内容の取得
	// ============================================================
	server.tool(
		"win_scrape",
		"Webページの内容をテキストとして取得する。\n" +
			"use_dom=false（デフォルト）: URLにHTTPリクエストを送りMarkdownで取得\n" +
			"use_dom=true: 現在ブラウザで開いているページのDOMからテキスト抽出（推奨）",
		{
			url: z.string().describe("取得するページのURL"),
			use_dom: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"DOMモード。現在ブラウザで開いているページから取得する場合はtrue",
				),
		},
		async ({ url, use_dom }) => {
			const client = getClient();
			const result = await client.scrape(url, use_dom ?? false);

			if (!result.success) {
				return {
					content: [
						{
							type: "text" as const,
							text: `❌ スクレイピング失敗: ${result.error}`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `📄 ページ内容:\n\n${result.data}`,
					},
				],
			};
		},
	);
}
