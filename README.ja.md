# ClaudeSync（日本語）

**先に確認し、タイトルを選び、安全なときだけ同期する。**

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync は、同じコンピューターで二つの Claude アカウントを使う人向けの、ローカルな Claude Code セッション一覧同期ツールです。何を追加できるかを表示し、タイトルの衝突を同じ表で選び、Claude が完全に停止した後だけインデックスを書き換えます。

![ClaudeSync interface](docs/images/claudesync-preview.svg)

> クラウド移行ツールではありません。ログイン、パスワード取得、会話のアップロード、Artifact の移行は行いません。

## インストーラー

[GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases/latest) から macOS（arm64/x64）、Windows（x64）、Debian/Ubuntu（amd64）のパッケージを選べます。画面は中国語、英語、日本語、スペイン語、ポルトガル語に対応しています。Mac 版は Python を同梱し、Tk のない Linux ではローカルのブラウザー画面に切り替わります。

## 使い方

Python 3.9 以降でリポジトリを取得します。

```sh
git clone https://github.com/PieAIStudio/ClaudeSync.git
cd ClaudeSync
```

- macOS: `Sync.command` をダブルクリック
- Windows: `Sync.bat` をダブルクリック
- Linux: `./Sync.sh`
- 全 OS: `python sync_gui.py`

初回起動で、二つのアカウントのインデックスを含むフォルダー、Account A/B のフォルダー、JSONL 本文の `projects` フォルダーを選びます。

1. 「Check」を押す（読み取り専用）。
2. 赤い「Needs choice」の行で Account A / Account B / Skip を選ぶ。
3. Claude の作業を保存し、「Sync safe items」または「Close Claude and sync」を押す。
4. Claude を開き、一覧を確認する。ログインとアカウント切替は手動です。

## ルールと範囲

同じタイトルは変更しません。手動タイトルと自動タイトルなら手動タイトルを安全に反映します。両方が異なる手動タイトルなら一行の選択待ち、両方が自動タイトルなら推測しません。古い「来自账号 X 的分支」マーカーは削除し、新しい分岐には長いマーカーを付けません。

JSONL 本文、既存入口、削除/アーカイブ記録、Artifact、コネクター、認証情報は変更しません。書き込み前にインデックスをバックアップし、後で検証します。

## コマンド

```sh
python sync_sessions.py --check
python sync_sessions.py --sync
python sync_sessions.py --close-sync
```

詳細は [English README](README.md)、保守境界は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。MIT ライセンスです。
