<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>次世代のMarkdownエディタ</strong><br>
  筆をとるのは、あなた。墨を磨るのは、AI。
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>公式サイト</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>ダウンロード</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  日本語 ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.pt.md">Português</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Textus"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
  <a href="https://github.com/CatVinci-Studio/Textus/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CatVinci-Studio/Textus/ci.yml?branch=main&label=CI"></a>
  <a href="https://textus.catvinci.com/discord"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/jaywcjlove/awesome-mac"><img alt="Awesome Mac" src="https://img.shields.io/badge/Awesome-Mac-FC60A8?logo=awesomelists&logoColor=white"></a>
</p>

https://github.com/user-attachments/assets/f366f282-e3f9-43d9-9a29-edb6d1ace3f5

<p align="center">
  <a href="https://www.youtube.com/watch?v=k_ew9TRljz0">YouTube で見る</a> ·
  <a href="https://www.bilibili.com/video/BV19LJb6WEWb">Bilibili</a>
</p>

<p align="center">
  <img src="docs/images/readme/ja/hero.png" alt="『吾輩は猫である』と読書メモを開いたTextus。Textus AIがメモを一文ずつ簡潔にし、修正は余白に並び、本文の横にはレビューのコメントが付いている。" width="860" /><br>
  <sub>夏目漱石『吾輩は猫である』</sub>
</p>

## Textusを入手

無料のオープンソース。MITライセンスで公開しています。

| プラットフォーム          | ダウンロード                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| macOS · Appleシリコン | [.dmgをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest)                           |
| macOS · Intel     | [.dmgをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest)                           |
| Windows · x64     | [.exeをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest)                           |
| Linux · x64       | [.AppImageをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest) · ほかの形式も .deb · .rpm |

Homebrewでもインストールできます：

```sh
brew install --cask textus
```

Arch Linux は署名付きの [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) pacman リポジトリで（設定は一度だけ。以後は `sudo pacman -Syu` で Textus も最新に保たれます）：

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

iPhone版とiPad版も、まもなく登場します。[すべてのリリースをGitHubで見る](https://github.com/CatVinci-Studio/Textus/releases)

新しいバージョンをいち早く使いたい場合は、**設定 › 一般 › Textus について** で **アップデートチャンネル** を **ベータ版** にすると、リリース候補版も届きます。いつでも **安定版** に戻せます。戻したあとは、より新しい安定版が出るまで今のバージョンのままです。

## 執筆

Markdownの記法は、書いたそばから仕上がりの姿に。行にポインタを合わせると、元の記法が現れます。

<p align="center">
  <img src="docs/images/readme/ja/markdown.png" alt="見たまま、書ける。" width="860" />
</p>

数式はその場で表示され、表はきれいに揃います。数行のテキストが、そのまま図になります。

<p align="center">
  <img src="docs/images/readme/ja/math.png" alt="数式も、表も、図も、すぐできる" width="860" />
</p>

### 書き方は？お好きなように

4つの書き方を自在に切り替え、テーマもすぐに変えられます。Typoraのテーマもそのまま使えます。

| 執筆モード      | どうなるか                   |
| ---------- | ----------------------- |
| 禅モード       | 文字以外のすべてが退きます           |
| タイプライターモード | 書いている行がいつも同じ高さにとどまります   |
| 分割表示       | Markdown と仕上がりを並べて見られます |
| ソースコードモード  | 文書全体を Markdown のまま扱えます  |

<p align="center">
  <img src="docs/images/readme/ja/split.png" alt="分割表示" width="49%" />
  <img src="docs/images/readme/ja/zen.png" alt="禅モード" width="49%" />
</p>

PDF、Word、HTMLなどに書き出せます。

## Textus AI

あなたの執筆アシスタント。一緒に書いていきます。

### 書いているとき

手を止めると、続きの言葉が灰色で現れます。Tabキーで採用。誤字や文法の誤りを、書きながら指摘。あなたの表記ルールも確かめます。Alt+Enterで修正。

### 頼んだとき

修正は、理由を添えた提案として届きます。まとめて適用することも、一文ずつ選ぶこともできます。コメントは、該当する行に付きます。書き直すのではなく、助言として。簡潔にする、校正、翻訳、口調を変えるなど。スラッシュひとつで呼び出せます。

### あなたを知っている

あなたの文体を学び、人物や場所の設定を覚え、執筆の指示に従います。

### LLMは、お好きなものを

Textus は20種類以上のLLMに対応し、OpenAI互換のAPIを備えたLLMならどれでも使えます。

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Doubao · Ollama · OpenAI互換のあらゆるエンドポイント

<p align="center">
  <img src="docs/images/readme/ja/settings.png" alt="LLMは、お好きなものを" width="860" />
</p>

## あなたが書いたものは、あなただけのもの

あなたの文章は、あなたのもの。Textusはそのために設計され、コードもすべて公開しています。

文書は普通のMarkdownファイル。置き場所はあなたが決めます。APIキーとサインイン情報は、あなたのコンピューターにだけ保存されます。AIへのリクエストは、デバイスから選んだプロバイダーへ直接届きます。ダウンロードして、書くだけ。登録するものは何もありません。分析も、テレメトリーも、広告もありません。MITライセンスで一行残らず公開。ここに書いたことは、誰でも確かめられます。 Ollamaでローカルモデルを使えば、あなたの言葉がコンピューターの外へ出ることはありません。

## よくある質問

<details>
<summary><strong>Textusは無料ですか？</strong></summary>

はい。MITライセンスのオープンソースで、アカウントもサブスクリプションも要りません。Textus AIの利用料は、選んだプロバイダーから直接請求されます。ローカルモデルなら費用はかかりません。

</details>

<details>
<summary><strong>どの環境で使えますか？</strong></summary>

macOS（AppleシリコンとIntel）、Windows、Linuxです。iPhone版とiPad版も準備中です。

</details>

<details>
<summary><strong>AIのアカウントは必要ですか？</strong></summary>

いいえ。エディタの機能は、AIなしですべて使えます。Textus AIを使うときは、ご自身のプロバイダーを接続します。ChatGPTやClaudeでのサインイン、APIキーの入力、Ollamaによるローカルモデルのどれでも使えます。

</details>

<details>
<summary><strong>オフラインでも使えますか？</strong></summary>

エディタはすべての機能が使えます。Textus AIにはプロバイダーへの接続が必要ですが、ローカルモデルならオフラインでも動きます。

</details>

<details>
<summary><strong>普通のMarkdownで、書き出しもできますか？</strong></summary>

はい、普通の.mdファイルです。表、タスクリスト、脚注、数式、Mermaidに対応し、PDF、Word、HTMLなどに書き出せます。

</details>

## はじめかた

1. Textus を起動します。白紙の下書きから始まり、ファイルが必要になるのは保存するときだけです。
2. **設定 → Textus AI** を開いてプロバイダーを選び、**ログインと認証** でサインインするかキーを貼り付けます。
3. 書き始めましょう。手を止めると続きが灰色で現れ、Tab で採用できます。
4. ウィンドウバーの **Textus AI** ボタン（ロボット）でAIパネルを開きます。詳しくは **ヘルプ → AI 機能ガイド** を。

ショートカットの一覧と変更は **設定 → ショートカット** から行えます。

## コミュニティ

- [Discord](https://textus.catvinci.com/discord)：お知らせ、サポート、フィードバック（英語）
- 中国語：[QQ グループ](https://textus.catvinci.com/qq)（1128285004）· [WeChat グループ](https://textus.catvinci.com/wechat)

不具合の報告や要望は [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues) へどうぞ。

## ロードマップと開発への参加

Textus の今後の方向は [ROADMAP.md](ROADMAP.md)（英語）にあります。ビルド、チェックの実行、プルリクエストの作成は [CONTRIBUTING.md](CONTRIBUTING.md)（英語）から始めてください。AI コーディングアシスタントは [AGENTS.md](AGENTS.md) に従います。やり取りは英語か中国語でお願いします。

## スターの推移

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## ライセンス

[MIT](./LICENSE) © CatVinci Studio
