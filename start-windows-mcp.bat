@echo off
REM ============================================================
REM AI Commander - Windows-MCP 起動スクリプト
REM
REM このバッチファイルは Windows-MCP を Streamable HTTP モードで
REM 起動します。AI Commander が Windows-MCP と通信するために、
REM 先にこのスクリプトを実行してください。
REM
REM 使い方:
REM   1. このファイルをダブルクリック、またはターミナルで実行
REM   2. 「Windows-MCP is running」と表示されたら起動完了
REM   3. 別のターミナルで AI Commander を起動
REM ============================================================

echo ============================================================
echo   Windows-MCP 起動スクリプト
echo   AI Commander が Windows-MCP と通信するために必要です
echo ============================================================
echo.
echo  接続先: http://localhost:8765
echo  トランスポート: Streamable HTTP
echo.
echo  終了するには Ctrl+C を押してください
echo ============================================================
echo.

REM Windows-MCP を Streamable HTTP モードで起動
REM ポート8765でリッスンし、AI Commander からの接続を受け付ける
uvx windows-mcp --transport streamable-http --host localhost --port 8765

REM エラーが発生した場合の案内
if %ERRORLEVEL% neq 0 (
    echo.
    echo ============================================================
    echo  エラーが発生しました！
    echo.
    echo  以下を確認してください:
    echo    1. Python 3.13+ がインストールされているか
    echo    2. uv がインストールされているか (pip install uv)
    echo    3. ネットワーク接続が正常か
    echo ============================================================
    pause
)
