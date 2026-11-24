#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 がありません。https://www.python.org/downloads/ からインストールしてください。"
  read -r -p "Enter を押すと終了します。"
  exit 1
fi
if [ ! -d .venv ]; then
  echo "初回セットアップ: Python仮想環境を作ります"
  python3 -m venv .venv
fi
source .venv/bin/activate
if [ ! -f .venv/.cellscope_ready ]; then
  echo "必要なライブラリをインストールしています（初回のみ）"
  python -m pip install -r requirements.txt
  touch .venv/.cellscope_ready
fi
python app.py
