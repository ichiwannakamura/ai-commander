/**
 * AI Commander - 設定管理
 *
 * 環境変数からの設定読み込みと、WebベースAIサービスの定義を管理する。
 * 新しいAIサービスを追加する場合は、WEB_AI_SERVICESに定義を追加するだけでOK。
 */

import dotenv from "dotenv";
import type {
	WindowsMcpConfig,
	WebAiService,
	WebAiServiceDefinition,
} from "./types.js";

// .envファイルの読み込み（プロジェクトルートに配置）
dotenv.config();

/**
 * Windows-MCPの起動設定を環境変数から構築する
 *
 * デフォルト: 「uvx windows-mcp」で子プロセスを起動する。
 * uvxはPythonのパッケージランナーで、Windows-MCPを自動インストール・実行する。
 * 環境変数で起動コマンドをカスタマイズ可能。
 */
export function getWindowsMcpConfig(): WindowsMcpConfig {
	const command = process.env.WINDOWS_MCP_COMMAND ?? "uvx";
	const argsStr = process.env.WINDOWS_MCP_ARGS ?? "windows-mcp";
	return {
		command,
		args: argsStr.split(" "),
		timeout: parseInt(process.env.WINDOWS_MCP_TIMEOUT ?? "60000", 10),
	};
}

/** AI応答の最大待機時間（秒） */
export function getAiResponseWaitSeconds(): number {
	return parseInt(process.env.AI_RESPONSE_WAIT_SECONDS ?? "30", 10);
}

/**
 * WebベースAIサービスの定義情報
 *
 * 各サービスごとの URL・テキストエリアの探し方・送信方法を定義。
 * Snapshotツールが返すインタラクティブ要素リストの中から、
 * inputKeywords にマッチする要素を「入力欄」として特定する。
 *
 * 新規サービスの追加手順:
 *   1. types.ts の WebAiService 型にサービス名を追加
 *   2. ここに WebAiServiceDefinition を追加
 *   → 他のコードは変更不要（自動的に対応される）
 */
export const WEB_AI_SERVICES: Record<WebAiService, WebAiServiceDefinition> = {
	chatgpt: {
		displayName: "ChatGPT",
		url: "https://chatgpt.com",
		inputKeywords: [
			"message chatgpt", // UIAutomationでの実際の名前
			"message",
			"prompt",
			"textarea",
			"chat",
			"ProseMirror",
			"contenteditable",
			"ask anything",
			"send a message",
		],
		sendKeywords: ["send", "submit", "arrow", "送信"],
	},
	grok: {
		displayName: "Grok",
		url: "https://grok.com",
		inputKeywords: ["textarea", "message", "input", "chat", "query"],
		sendKeywords: ["send", "submit", "arrow", "送信"],
	},
	"gemini-web": {
		displayName: "Gemini (Web)",
		url: "https://gemini.google.com/app",
		inputKeywords: ["textarea", "rich-textarea", "input", "chat", "message"],
		sendKeywords: ["send", "submit", "arrow", "送信"],
	},
	copilot: {
		displayName: "Microsoft Copilot",
		url: "https://copilot.microsoft.com",
		inputKeywords: ["textarea", "input", "message", "chat", "ask"],
		sendKeywords: ["send", "submit", "arrow", "送信"],
	},
};

/**
 * サービス名がWebAiServiceとして有効かを型安全にチェック
 *
 * ユーザー入力のバリデーションに使用。
 * WEB_AI_SERVICESの存在チェックで判定するため、
 * 新サービス追加時に自動的に対応される。
 */
export function isValidWebAiService(name: string): name is WebAiService {
	return name in WEB_AI_SERVICES;
}
