# ai-commander

複数のAIプロバイダー（Claude / OpenAI / Gemini / Grok / Ollama）にロールベースでプロンプトをルーティングするCLIツール。

## 必要な環境

- Node.js 20+
- Python 3.11+
- 使用するプロバイダーのAPIキー

## セットアップ

```bash
# 1. 依存パッケージをインストール
npm install
pip install anthropic openai google-generativeai requests

# 2. APIキーを環境変数に設定
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="AIza..."
export XAI_API_KEY="xai-..."
# Ollama はローカル実行なのでキー不要

# 3. 設定を確認
npm run build
npx ai-cmd doctor
```

## 使い方

```bash
# プロンプトを送信（ロールを自動検出）
npx ai-cmd "このコードをレビューして"

# ロールを明示指定
npx ai-cmd --role coder "TypeScriptで配列をソートする関数を書いて"

# 複数ロールに並列送信
npx ai-cmd --role coder,reviewer "バグを修正して"

# ルーティングだけ確認（実行なし）
npx ai-cmd --dry-run --role planner "DBスキーマを設計して"

# JSON形式で出力
npx ai-cmd --json "summarize this" | jq .overall_status

# タイムアウト調整
npx ai-cmd --timeout 60 --role-timeout 30 "長い文章を要約して"
```

## コマンド一覧

```bash
ai-cmd <prompt>              プロンプトをAIへ送信
ai-cmd roles list            ロール一覧とAPIキー状態を表示
ai-cmd roles show <role>     ロールの詳細を表示
ai-cmd roles add <name>      新しいロールをroles.yamlに追加
ai-cmd roles validate <role> APIキーと疎通確認
ai-cmd doctor                設定の総合診断
ai-cmd serve                 MCPサーバーとして起動
```

## ロール設定（roles.yaml）

```yaml
roles:
  coder:
    ai: claude
    model: claude-sonnet-4-6
    system: "You are an expert software engineer."
  reviewer:
    ai: openai
    model: gpt-4o
  local:
    ai: ollama
    model: llama3.2
```

## 設定ファイル（config.yaml）

```yaml
api_keys:
  claude: ${ANTHROPIC_API_KEY}
  openai: ${OPENAI_API_KEY}
  gemini: ${GEMINI_API_KEY}
  grok: ${XAI_API_KEY}

timeouts:
  global_timeout_s: 30
  role_timeout_s: 20
  retries: 2

default_role: coder

mcp:
  port: 3000
  host: "127.0.0.1"
```

## Docker / WSL での Ollama 利用

```bash
export OLLAMA_API_URL="http://host.docker.internal:11434/api/chat"
```

## テスト

```bash
# TypeScript
npm test

# Python
pytest
```

## 新しいAIプロバイダーの追加

1. `adapters/<name>_adapter.py` を作成し `BaseAdapter` を継承
2. `call(req: AdapterRequest) -> dict` を実装
3. `src/dispatcher.ts` の `ADAPTER_MAP` と `ADAPTER_ENV_KEYS` に追加
4. `src/cli.ts` の `VALID_PROVIDERS` と `PROVIDER_ENV_KEYS` に追加
5. `roles.yaml` にロールを追加
