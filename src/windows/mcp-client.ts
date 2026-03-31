/**
 * AI Commander - Windows-MCP Stdioクライアント
 *
 * Windows-MCPを子プロセスとして自動起動し、
 * MCP SDK の StdioClientTransport で通信する。
 *
 * これにより:
 *   - ワンさんがWindows-MCPを手動で起動する必要がない
 *   - AI Commanderを登録するだけで全機能が使える
 *   - Claude Desktop / Claude Code / Cursor のどれでも動く
 *
 * 内部アーキテクチャ:
 *   AI Commander (親プロセス)
 *     └─ Windows-MCP (子プロセス, stdio接続)
 *          └─ Windows OS操作 (Win32 API / UIAutomation)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { WindowsMcpConfig, ToolCallResult } from "../types.js";

/**
 * Windows-MCPサーバーへのStdioクライアント
 *
 * Windows-MCPを子プロセス（uvx windows-mcp）として起動し、
 * MCP標準のstdio通信でツールを呼び出す。
 *
 * 使い方:
 *   const client = new WindowsMcpClient(config);
 *   await client.initialize();  // Windows-MCP子プロセスが起動される
 *   const result = await client.snapshot(true, false);
 *   await client.disconnect();  // 子プロセスを終了
 */
export class WindowsMcpClient {
	private readonly config: WindowsMcpConfig;
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private connected = false;

	constructor(config: WindowsMcpConfig) {
		this.config = config;
	}

	/**
	 * Windows-MCPを子プロセスとして起動し、接続を確立する
	 *
	 * 内部で「uvx windows-mcp」を実行し、stdioパイプで通信を開始する。
	 * 初回起動時はWindows-MCPの依存パッケージダウンロードで
	 * 1〜2分かかる場合がある。
	 */
	async initialize(): Promise<void> {
		// StdioClientTransport:
		//   指定コマンドを子プロセスとして起動し、
		//   stdin/stdout経由でMCPプロトコルを話す
		this.transport = new StdioClientTransport({
			command: this.config.command,
			args: this.config.args,
			stderr: "pipe", // エラー出力はパイプして内部ログに使う
		});

		// MCPクライアントを作成して接続
		this.client = new Client({
			name: "ai-commander",
			version: "1.0.0",
		});

		await this.client.connect(this.transport);
		this.connected = true;

		console.error("✅ Windows-MCP 子プロセスを起動・接続しました");
	}

	/**
	 * Windows-MCPのツールを呼び出す汎用メソッド
	 *
	 * 全てのツール呼び出しはこのメソッドを経由する。
	 * ツール名とパラメータを渡すと、Windows-MCPに送信して結果を返す。
	 */
	async callTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult> {
		if (!this.connected || !this.client) {
			return {
				success: false,
				data: "",
				error:
					"Windows-MCPに接続されていません。initialize()を先に呼んでください。",
			};
		}

		try {
			const result = await this.client.callTool({
				name: toolName,
				arguments: args,
			});

			// エラーフラグが立っている場合
			if (result.isError) {
				const errorText = this.extractTextFromContent(result.content);
				return {
					success: false,
					data: "",
					error: `ツールエラー: ${errorText}`,
				};
			}

			// 正常結果からテキストを抽出
			const resultText = this.extractTextFromContent(result.content);
			return {
				success: true,
				data: resultText,
			};
		} catch (error) {
			return {
				success: false,
				data: "",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// ============================================================
	// 便利メソッド: Windows-MCPの各ツールに対応
	// ============================================================

	/**
	 * 画面の状態をスナップショットで取得する
	 *
	 * Windows-MCPのSnapshotツールを呼び出す。
	 * use_dom=true にするとブラウザのDOM解析モードになり、
	 * Webページのテキスト入力欄やボタンを正確に取得できる。
	 */
	async snapshot(
		useDom: boolean = false,
		useVision: boolean = false,
	): Promise<ToolCallResult> {
		return this.callTool("Snapshot", {
			use_dom: useDom,
			use_vision: useVision,
		});
	}

	/**
	 * 指定座標をクリックする
	 *
	 * button: "left"（通常クリック）, "right"（右クリック）, "middle"（中クリック）
	 * clicks: 1=シングル, 2=ダブルクリック, 0=ホバーのみ
	 */
	async click(
		loc: [number, number],
		button: "left" | "right" | "middle" = "left",
		clicks: number = 1,
	): Promise<ToolCallResult> {
		return this.callTool("Click", { loc, button, clicks });
	}

	/**
	 * 指定座標にテキストを入力する
	 *
	 * clear=true: 既存テキストをクリアしてから入力
	 * pressEnter=true: 入力後にEnterキーを押す（チャット送信等に使う）
	 */
	async type(
		loc: [number, number],
		text: string,
		clear: boolean = false,
		pressEnter: boolean = false,
	): Promise<ToolCallResult> {
		return this.callTool("Type", {
			loc,
			text,
			clear,
			press_enter: pressEnter,
		});
	}

	/**
	 * キーボードショートカットを送る
	 *
	 * 例: "Return"（Enter）, "Ctrl+c", "Alt+Tab"
	 */
	async shortcut(keys: string): Promise<ToolCallResult> {
		return this.callTool("Shortcut", { shortcut: keys });
	}

	/**
	 * 指定時間待機する（秒単位）
	 */
	async wait(seconds: number): Promise<ToolCallResult> {
		return this.callTool("Wait", { duration: seconds });
	}

	/**
	 * アプリケーション操作
	 *
	 * mode: "launch"（起動）, "resize"（サイズ変更）, "switch"（切り替え）
	 */
	async app(
		mode: "launch" | "resize" | "switch",
		name?: string,
	): Promise<ToolCallResult> {
		const args: Record<string, unknown> = { mode };
		if (name) args.name = name;
		return this.callTool("App", args);
	}

	/**
	 * スクロール操作
	 */
	async scroll(
		loc: [number, number],
		direction: "up" | "down" | "left" | "right" = "down",
		wheelTimes: number = 3,
	): Promise<ToolCallResult> {
		return this.callTool("Scroll", {
			loc,
			direction,
			wheel_times: wheelTimes,
		});
	}

	/**
	 * Webページの内容をスクレイピングする
	 *
	 * use_dom=true: アクティブなブラウザタブのDOMからテキストを抽出
	 * use_dom=false: HTTPリクエストでURLの内容を取得
	 */
	async scrape(url: string, useDom: boolean = false): Promise<ToolCallResult> {
		return this.callTool("Scrape", { url, use_dom: useDom });
	}

	/**
	 * PowerShellコマンドを実行する
	 */
	async shell(command: string, timeout: number = 30): Promise<ToolCallResult> {
		return this.callTool("Shell", { command, timeout });
	}

	/**
	 * クリップボードの読み書き
	 */
	async clipboard(mode: "get" | "set", text?: string): Promise<ToolCallResult> {
		const args: Record<string, unknown> = { mode };
		if (text !== undefined) args.text = text;
		return this.callTool("Clipboard", args);
	}

	/** 接続状態の確認 */
	get isConnected(): boolean {
		return this.connected;
	}

	/**
	 * 子プロセスを終了し、接続を切断する
	 */
	async disconnect(): Promise<void> {
		if (this.client) {
			await this.client.close();
			this.client = null;
		}
		if (this.transport) {
			await this.transport.close();
			this.transport = null;
		}
		this.connected = false;
		console.error("🔴 Windows-MCP 子プロセスを終了しました");
	}

	// ============================================================
	// プライベートヘルパー
	// ============================================================

	/**
	 * MCP応答のcontentフィールドからテキストを抽出する
	 *
	 * MCP SDK の callTool が返す content 配列から、
	 * type="text" のアイテムのテキストを全て結合して返す。
	 */
	private extractTextFromContent(content: unknown): string {
		if (!content) return "";

		// MCP SDK の content は TextContent | ImageContent | EmbeddedResource の配列
		if (Array.isArray(content)) {
			return content
				.map((item: ContentItem) => {
					if (typeof item === "string") return item;
					// TextContent: { type: "text", text: "..." }
					if (item?.type === "text" && typeof item.text === "string") {
						return item.text;
					}
					return JSON.stringify(item);
				})
				.join("\n");
		}

		if (typeof content === "string") return content;
		return JSON.stringify(content);
	}
}

/** MCP応答のコンテンツアイテム型 */
interface ContentItem {
	type?: string;
	text?: string;
	[key: string]: unknown;
}
