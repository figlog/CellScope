# CellScope — Hemocytometer Counter

CellScopeは、顕微鏡画像（TIFF/PNG/JPEGなど）から細胞を計数する、**ローカル実行のブラウザGUI**です。画像のROIを指定し、細胞候補を自動検出したあと、GUI上で個数と採否を手動修正できます。A〜Dの4区画で細胞濃度（cells/mL）を計算し、CSV・注釈画像・作業再開用JSONを保存できます。

- Python + NumPy + OpenCV のみ（Flask / Streamlit / Jupyter 不要）
- 画像は外部のクラウドに送信しません（`127.0.0.1` 上で動作）
- `run_windows.bat` はこのリポジトリに含めません
- 実験画像や過去の計数座標 `previous_data.json` も含めません

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

Windowsでは通常 `py -3` を `python` の代わりに使えます。**Pythonが入っていないWindowsでは起動できません。** また、GitHub Pagesにアップロードするだけでは画像処理用のPythonサーバーが起動しないため、Webアプリとしては動作しません。

## 計数式

各計数区画が 1 mm × 1 mm × 0.1 mm = 10⁻⁴ mL の場合、

```text
cells/mL = (A+B+C+D) / 4 * 10000 * dilution_factor
```

自動検出は暫定候補です。格子線上・密集部・気泡・ゴミの目視確認が必要です。研究用途の試作版であり、医療診断用途を想定していません。

使い方の詳細は [README_ja.md](README_ja.md) を参照してください。
