# CellScope — Hemocytometer Counter

CellScopeは、顕微鏡画像（TIFF/PNG/JPEGなど）から細胞を計数する、**ローカル実行のブラウザGUI**です。画像のROIを指定し、細胞候補を自動検出したあと、GUI上で個数と採否を手動修正できます。A〜Dの4区画で細胞濃度（cells/mL）を計算し、CSV・注釈画像・作業再開用JSONを保存できます。

- ワンセルカウンターはこちらを使っています．左上にOneCellとロゴがある，使い捨てのものです．http://www.fpi1.co.jp/oc-c-s02.html
- 厚さは0.10mmの製品ですので，違う場合には体積分を手動で補正してください．
- 画像処理には Python + NumPy + OpenCV を使用（Flask / Streamlit / Jupyter 不要）
- 画像は外部のクラウドに送信しません（`127.0.0.1` 上で動作）
- macOS・Windows 10/11 対応（Windows は `uv` を事前にインストール）


## Windows 10/11での起動（uvを使用）

WindowsにはPythonを事前にインストールする必要はありませんが、**uv** が必要です。

1. PowerShellで公式のuvインストールコマンドを実行します（[公式手順](https://docs.astral.sh/uv/getting-started/installation/)）。
   ```powershell
   irm https://astral.sh/uv/install.ps1 | iex
   ```
2. PowerShellを一度閉じて開き直し、`uv --version` で確認します。
3. GitHubの「Code → Download ZIP」から取得して展開するか、リポジトリをcloneします。
4. 展開したフォルダの **`run_windows.bat`** をダブルクリックします。
5. 初回はuvがPython 3.13環境（`.venv`）の準備とライブラリのインストールを行い、その後CellScopeを起動します。
6. 停止時は起動したコマンドプロンプトで `Ctrl+C` を押します。

> 注：uvがPython本体をダウンロードする際など、初回はインターネット接続が必要です。起動できない場合はコマンドプロンプトから `run_windows.bat` を実行してエラーを確認してください。

## macOSでの起動

Python 3 がインストールされているMacで、このリポジトリのフォルダから実行します。

```bash
bash run_mac.command
```

初回は仮想環境 `.venv` を作成し必要なライブラリをインストールします。ブラウザに `http://127.0.0.1:8765/` が開きます（他のポートになる場合があります）。終了はターミナルで `Control+C`。

## 共通の手動起動

Python 3.10以降をインストールした環境で：

```bash
python -m pip install -r requirements.txt
python app.py
```

Windowsで手動起動する場合はPythonのインストールが必要ですが、上記の `run_windows.bat` は **uvを使うため、Pythonの事前インストールは不要**です。GitHub Pagesだけでは画像処理用のPythonサーバーが起動しないため、Webアプリとしては動作しません。

## 計数式

各計数区画が 1 mm × 1 mm × 0.1 mm = 10⁻⁴ mL の場合、

```text
cells/mL = (A+B+C+D) / 4 * 10000 * dilution_factor
```

自動検出は暫定候補です。格子線上・密集部・気泡・ゴミの目視確認が必要です。研究用途の試作版であり、医療診断用途を想定していません。

使い方の詳細は [README_ja.md](README_ja.md) を参照してください。
