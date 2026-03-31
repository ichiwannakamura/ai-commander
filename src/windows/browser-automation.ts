/**
 * AI Commander - ブラウザ自動操作エンジン
 *
 * Windows-MCPクライアントを使って、WebベースのAIサービス
 * （ChatGPT, Grok等）に自動で質問を送り、回答を取得する。
 *
 * 処理の流れ:
 *   1. 対象AIサービスのウィンドウを探して前面に出す
 *   2. Snapshotでページ状態を取得（パイプ区切り形式をパース）
 *   3. テキスト入力欄を見つけてクリック
 *   4. 質問テキストを入力してEnterで送信
 *   5. 応答完了を待ってスクレイピング
 *   6. 回答テキストを返す
 */

import type { WindowsMcpClient } from "./mcp-client.js";
import { WEB_AI_SERVICES, getAiResponseWaitSeconds } from "../config.js";
import type {
	WebAiService,
	AiChatResult,
	InteractiveElement,
	ToolCallResult,
} from "../types.js";

/**
 * ブラウザ自動操作クラス
 *
 * Windows-MCPを介してブラウザを操作し、WebベースAIとの対話を自動化する。
 */
export class BrowserAutomation {
	private client: WindowsMcpClient;

	constructor(client: WindowsMcpClient) {
		this.client = client;
	}

	// ============================================================
	// 高レベルAPI: AIチャット自動化
	// ============================================================

	/**
	 * WebベースAIサービスに質問を送信し、回答を取得する
	 *
	 * 全工程（ウィンドウ切替→質問入力→送信→回答取得）を自動実行する。
	 * 事前条件: 対象のAIサービスにブラウザでログイン済みであること。
	 */
	async askWebAi(
		service: WebAiService,
		question: string,
	): Promise<AiChatResult> {
		const startTime = Date.now();
		const serviceConfig = WEB_AI_SERVICES[service];
		const waitSeconds = getAiResponseWaitSeconds();

		try {
			// ステップ1: 対象のブラウザウィンドウを前面に出す
			// startコマンドではなく、まず既存ウィンドウの切替を試みる
			await this.activateBrowserWindow(serviceConfig.url);
			await this.client.wait(3);

			// ステップ2: ページの状態を取得
			// use_dom=true でブラウザのDOM要素を詳しく取得
			const snapshotResult = await this.client.snapshot(true, false);
			if (!snapshotResult.success) {
				throw new Error(`画面状態の取得に失敗: ${snapshotResult.error}`);
			}

			// ステップ3: テキスト入力欄を探す
			const elements = this.parseInteractiveElements(snapshotResult.data);
			const inputElement = this.findInputElement(
				elements,
				serviceConfig.inputKeywords,
			);

			if (!inputElement) {
				// 入力欄が見つからない場合、デバッグ情報を含めてエラー
				throw new Error(
					`テキスト入力欄が見つかりませんでした。\n` +
						`サービス: ${serviceConfig.displayName}\n` +
						`ログイン状態を確認してください。\n` +
						`検出された要素数: ${elements.length}\n` +
						`検出された要素一覧:\n${elements.map((e) => `  [${e.index}] ${e.controlType} "${e.name}" (${e.x},${e.y})`).join("\n")}\n` +
						`\nSnapshotの生データ（先頭1000文字）:\n${snapshotResult.data.slice(0, 1000)}`,
				);
			}

			// ステップ4: 入力欄をクリック
			await this.client.click([inputElement.x, inputElement.y]);
			await this.client.wait(1);

			// ステップ5: 質問テキストを入力して送信
			await this.client.type(
				[inputElement.x, inputElement.y],
				question,
				true, // 既存テキストをクリア
				true, // Enterキーで送信
			);

			// ステップ6: 応答が生成されるまで待機
			await this.client.wait(waitSeconds);

			// ステップ7: 応答をスクレイピング
			const scrapeResult = await this.client.scrape(
				serviceConfig.url,
				true, // DOMモードで取得
			);

			let answer: string;
			if (scrapeResult.success) {
				answer = scrapeResult.data;
			} else {
				// スクレイピング失敗時はSnapshotで再取得
				const retrySnapshot = await this.client.snapshot(true, false);
				answer = retrySnapshot.success
					? retrySnapshot.data
					: "応答の取得に失敗しました。画面を確認してください。";
			}

			const elapsedSeconds = (Date.now() - startTime) / 1000;

			return {
				success: true,
				service,
				question,
				answer,
				elapsedSeconds,
			};
		} catch (error) {
			const elapsedSeconds = (Date.now() - startTime) / 1000;
			return {
				success: false,
				service,
				question,
				answer: "",
				error: error instanceof Error ? error.message : String(error),
				elapsedSeconds,
			};
		}
	}

	// ============================================================
	// 中レベルAPI: ブラウザ操作
	// ============================================================

	/**
	 * 対象AIサービスのブラウザウィンドウを前面に出す
	 *
	 * 戦略:
	 *   1. まずAppツールでブラウザを切替（Chrome/Edge等のウィンドウを前景に）
	 *   2. 切替できなかった場合のみ、shellでURLを開く
	 *
	 * Vivaldiがデフォルトブラウザの場合でも、ChatGPTが
	 * Chrome上で開いていればChromeを前面に出す。
	 */
	async activateBrowserWindow(url: string): Promise<ToolCallResult> {
		// まず現在の画面状態を確認して、対象ウィンドウを探す
		const snapshot = await this.client.snapshot(false, false);
		if (snapshot.success) {
			const snapshotData = snapshot.data.toLowerCase();

			// 対象サービス名がウィンドウタイトルに含まれているか確認
			const serviceNames = ["chatgpt", "grok", "gemini", "copilot"];
			const urlDomain = new URL(url).hostname;

			for (const serviceName of serviceNames) {
				if (
					url.toLowerCase().includes(serviceName) &&
					snapshotData.includes(serviceName)
				) {
					// ウィンドウが存在する → Appツールで切替
					// Chromeウィンドウに切り替え
					const switchResult = await this.client.app("switch", "Chrome");
					if (switchResult.success) {
						return switchResult;
					}
					// Chrome切替失敗時はEdge、Vivaldiなど他のブラウザも試す
					for (const browser of ["Edge", "Vivaldi", "Firefox"]) {
						const altResult = await this.client.app("switch", browser);
						if (altResult.success) return altResult;
					}
				}
			}

			// ウィンドウタイトルにドメイン名が含まれているか確認
			if (snapshotData.includes(urlDomain)) {
				const switchResult = await this.client.app("switch", "Chrome");
				if (switchResult.success) return switchResult;
			}
		}

		// ウィンドウが見つからない → 新しくブラウザで開く
		return this.client.shell(`start "" "${url}"`, 10);
	}

	/**
	 * 現在の画面状態を取得する
	 */
	async getPageState(useDom: boolean = true): Promise<ToolCallResult> {
		return this.client.snapshot(useDom, false);
	}

	/**
	 * ページ内容をスクレイピングして取得する
	 */
	async getPageContent(
		url: string,
		useDom: boolean = true,
	): Promise<ToolCallResult> {
		return this.client.scrape(url, useDom);
	}

	// ============================================================
	// Snapshot パーサー（パイプ区切り形式対応）
	// ============================================================

	/**
	 * Snapshotの結果テキストからインタラクティブ要素を抽出する
	 *
	 * Windows-MCPのSnapshotはパイプ区切り形式で要素を返す:
	 *
	 *   # id|window|control_type|name|coords|focus
	 *   0|ChatGPT - Google Chrome|Edit|Message ChatGPT|(681,899)|False
	 *   1|ChatGPT - Google Chrome|Button|Send|(890,899)|False
	 *
	 * この形式をパースして InteractiveElement の配列にする。
	 */
	parseInteractiveElements(snapshotData: string): InteractiveElement[] {
		const elements: InteractiveElement[] = [];
		const lines = snapshotData.split("\n");

		for (const line of lines) {
			const trimmed = line.trim();

			// ヘッダー行やコメント行をスキップ
			if (
				!trimmed ||
				trimmed.startsWith("#") ||
				trimmed.startsWith("Active") ||
				trimmed.startsWith("Focused") ||
				trimmed.startsWith("Opened") ||
				trimmed.startsWith("List of") ||
				trimmed.startsWith("All ") ||
				trimmed.startsWith("No ")
			) {
				continue;
			}

			// パターン1: パイプ区切り形式（現行のWindows-MCP出力形式）
			// 例: 0|ChatGPT - Google Chrome|Edit|Message ChatGPT|(681,899)|False
			const pipeMatch = trimmed.match(
				/^(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|\((\d+),\s*(\d+)\)\|/,
			);
			if (pipeMatch) {
				elements.push({
					index: parseInt(pipeMatch[1], 10),
					controlType: pipeMatch[3].trim(),
					name: pipeMatch[4].trim(),
					x: parseInt(pipeMatch[5], 10),
					y: parseInt(pipeMatch[6], 10),
				});
				continue;
			}

			// パターン2: ブラケット形式（旧バージョン互換）
			// 例: [12] Edit "Message ChatGPT" (450, 680)
			const bracketMatch = trimmed.match(
				/\[(\d+)\]\s+(\w+)\s+(?:"([^"]*)")?\s*\((\d+),\s*(\d+)\)/,
			);
			if (bracketMatch) {
				elements.push({
					index: parseInt(bracketMatch[1], 10),
					controlType: bracketMatch[2],
					name: bracketMatch[3] ?? "",
					x: parseInt(bracketMatch[4], 10),
					y: parseInt(bracketMatch[5], 10),
				});
				continue;
			}

			// パターン3: パイプ区切りだが座標のフォーマットが少し違う場合
			// 例: 0|window|Edit|name|(681, 899)|False  （スペースあり）
			const pipeSpaceMatch = trimmed.match(
				/^(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|\(\s*(\d+)\s*,\s*(\d+)\s*\)\|/,
			);
			if (pipeSpaceMatch) {
				elements.push({
					index: parseInt(pipeSpaceMatch[1], 10),
					controlType: pipeSpaceMatch[3].trim(),
					name: pipeSpaceMatch[4].trim(),
					x: parseInt(pipeSpaceMatch[5], 10),
					y: parseInt(pipeSpaceMatch[6], 10),
				});
			}
		}

		return elements;
	}

	/**
	 * インタラクティブ要素リストからテキスト入力欄を探す
	 *
	 * 優先順位（上から順に試す）:
	 *   1. controlTypeが "Edit" + キーワードマッチ（最も確実）
	 *   2. controlTypeが "Edit"（キーワード関係なく）
	 *   3. controlTypeが "Document"（contenteditable要素）
	 *   4. 任意タイプ + キーワードマッチ
	 *   5. "textbox", "input", "textarea" タイプ（DOM要素名の場合）
	 */
	findInputElement(
		elements: InteractiveElement[],
		keywords: string[],
	): InteractiveElement | null {
		if (elements.length === 0) return null;

		const lowerKeywords = keywords.map((k) => k.toLowerCase());

		// 戦略1: "Edit" タイプ + キーワードマッチ（最も確実）
		for (const element of elements) {
			const type = element.controlType.toLowerCase();
			if (type === "edit") {
				if (this.matchesKeyword(element.name, lowerKeywords)) {
					return element;
				}
			}
		}

		// 戦略2: "Edit" タイプなら名前に関係なく採用（最後のEdit）
		const editElements = elements.filter(
			(el) => el.controlType.toLowerCase() === "edit",
		);
		if (editElements.length > 0) {
			// 最後のEdit要素を返す（チャットUIでは通常最後が入力欄）
			return editElements[editElements.length - 1];
		}

		// 戦略3: "Document" タイプ（contenteditable要素、ChatGPTで多い）
		for (const element of elements) {
			const type = element.controlType.toLowerCase();
			if (type === "document") {
				if (this.matchesKeyword(element.name, lowerKeywords)) {
					return element;
				}
			}
		}
		// Document要素のうち最後のものも候補
		const docElements = elements.filter(
			(el) => el.controlType.toLowerCase() === "document",
		);
		if (docElements.length > 0) {
			return docElements[docElements.length - 1];
		}

		// 戦略4: キーワードマッチする任意の要素
		for (const element of elements) {
			if (this.matchesKeyword(element.name, lowerKeywords)) {
				return element;
			}
		}

		// 戦略5: textbox, input, textarea タイプ（DOMのrole名の場合）
		for (const element of elements) {
			const type = element.controlType.toLowerCase();
			if (type === "textbox" || type === "input" || type === "textarea") {
				return element;
			}
		}

		return null;
	}

	/**
	 * 送信ボタンを探す
	 */
	findSendButton(
		elements: InteractiveElement[],
		keywords: string[],
	): InteractiveElement | null {
		const lowerKeywords = keywords.map((k) => k.toLowerCase());
		for (const element of elements) {
			if (element.controlType.toLowerCase() !== "button") continue;
			if (this.matchesKeyword(element.name, lowerKeywords)) {
				return element;
			}
		}
		return null;
	}

	// ============================================================
	// プライベートヘルパー
	// ============================================================

	/**
	 * 要素名がキーワードリストのいずれかにマッチするかチェック
	 */
	private matchesKeyword(name: string, lowerKeywords: string[]): boolean {
		const lowerName = name.toLowerCase();
		return lowerKeywords.some((keyword) => lowerName.includes(keyword));
	}
}
