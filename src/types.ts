/**
 * AI Commander - 共通型定義
 *
 * Windows-MCPを介して他AIを自動操作するための型システム。
 * 全モジュールで共有される型を一箇所に集約し、型安全性を保証する。
 */

// ============================================================
// Windows-MCP 接続関連
// ============================================================

/** Windows-MCPの起動・接続設定 */
export interface WindowsMcpConfig {
	/** Windows-MCPを起動するコマンド（例: "uvx"） */
	command: string;
	/** コマンドの引数（例: ["windows-mcp"]） */
	args: string[];
	/** 操作タイムアウト（ミリ秒） */
	timeout: number;
}

/** Windows-MCPツール呼び出しの結果 */
export interface ToolCallResult {
	/** 成功したかどうか */
	success: boolean;
	/** 結果データ（Windows-MCPからの応答テキスト） */
	data: string;
	/** エラーメッセージ（失敗時のみ） */
	error?: string;
}

// ============================================================
// WebベースAIサービス関連
// ============================================================

/** 対応するWebベースAIサービスの識別名 */
export type WebAiService = "chatgpt" | "grok" | "gemini-web" | "copilot";

/** 全サービス名の一覧（バリデーション・列挙用） */
export const WEB_AI_SERVICE_NAMES: readonly WebAiService[] = [
	"chatgpt",
	"grok",
	"gemini-web",
	"copilot",
] as const;

/**
 * WebベースAIサービスの定義情報
 *
 * 各サービスのURL・操作ヒントを保持する。
 * ブラウザ自動操作時に、この情報をもとに操作手順を決定する。
 */
export interface WebAiServiceDefinition {
	/** サービスの日本語表示名 */
	displayName: string;
	/** サービスのURL */
	url: string;
	/**
	 * テキスト入力エリアを探す際のキーワード群
	 * Snapshotの結果からこれらのキーワードでマッチングする
	 */
	inputKeywords: string[];
	/**
	 * 送信ボタンを探す際のキーワード群
	 * 見つからない場合はEnterキーで代替
	 */
	sendKeywords: string[];
}

/** AI自動チャットの実行結果 */
export interface AiChatResult {
	/** 成功したかどうか */
	success: boolean;
	/** 使用したAIサービス名 */
	service: WebAiService;
	/** 送った質問テキスト */
	question: string;
	/** 取得した回答テキスト */
	answer: string;
	/** エラーメッセージ（失敗時のみ） */
	error?: string;
	/** 処理にかかった合計時間（秒） */
	elapsedSeconds: number;
}

// ============================================================
// Snapshot パース関連
// ============================================================

/**
 * Snapshot内のインタラクティブ要素
 *
 * Windows-MCPのSnapshotツールが返す
 * 「List of Interactive Elements」セクション内の各要素を表す。
 * 例: [12] Edit "Message ChatGPT" (450, 680)
 */
export interface InteractiveElement {
	/** 要素のインデックス番号 */
	index: number;
	/** 要素の種類（Button, Edit, Link等） */
	controlType: string;
	/** 要素の名前/ラベル */
	name: string;
	/** クリック位置のX座標 */
	x: number;
	/** クリック位置のY座標 */
	y: number;
}
