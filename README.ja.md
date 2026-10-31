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

| プラットフォーム | ダウンロード | その他のインストール方法 |
| --- | --- | --- |
| macOS · Appleシリコン | [.dmgをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest) | Homebrew：`brew install --cask textus` |
| macOS · Intel | [.dmgをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest) | Homebrew：`brew install --cask textus` |
| Windows · x64 | [.exeをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest) | — |
| Linux · x64 | [.AppImageをダウンロード](https://github.com/CatVinci-Studio/Textus/releases/latest) · ほかの形式も .deb · .rpm | Arch Linux：[`[catvinci]` リポジトリ](https://github.com/CatVinci-Studio/arch-repo) |

> iPhone版とiPad版は、まもなくApp Storeで公開します（中国本土を除く）。

ベータ版：**設定 › 一般 › Textus について** で **アップデートチャンネル** を **ベータ版** にします。

## 執筆

見たまま、書ける。入力するそばからMarkdownで整います。PDF、Word、HTMLなどに書き出せます。

<p align="center">
  <img src="docs/images/readme/ja/markdown.webp" alt="見出し、太字と斜体、引用、リスト、タスク、リンク、注釈など、Markdownの記法をすべて使った文書が整って表示されている" width="860" />
</p>

| コードブロック | 表 |
| :---: | :---: |
| <img src="docs/images/readme/ja/code.webp" alt="言語に合わせて色分けされたコードブロック" width="420" /> | <img src="docs/images/readme/ja/table.webp" alt="列がきれいに揃った表" width="420" /> |
| **数式** | **ダイアグラム** |
| <img src="docs/images/readme/ja/formula.webp" alt="入力するそばから描かれる数式" width="420" /> | <img src="docs/images/readme/ja/diagram.webp" alt="Mermaidのフローチャート" width="420" /> |

## Textus AI

オンラインのLLMにもローカルのLLMにも対応。AIが執筆を加速します。

| 続きの提案 | 誤字と文法 | 修正の提案 |
| :---: | :---: | :---: |
| <img src="docs/images/readme/ja/ai-continue.webp" alt="手を止めると続きが灰色で現れ、Tabで採用" width="280" /> | <img src="docs/images/readme/ja/ai-grammar.webp" alt="誤りに下線、Alt+Enterで修正" width="280" /> | <img src="docs/images/readme/ja/ai-revise.webp" alt="一文ずつの修正案、それぞれに理由つき" width="280" /> |
| **レビューコメント** | **スラッシュスキル** | **好きなモデルで** |
| <img src="docs/images/readme/ja/ai-review.webp" alt="該当する文に付いたコメント" width="280" /> | <img src="docs/images/readme/ja/ai-skills.webp" alt="/ で開くスキルメニュー" width="280" /> | <img src="docs/images/readme/ja/ai-models.webp" alt="設定でプロバイダーを選ぶ" width="280" /> |

## プラグイン

書くだけでなく、必要なものはプラグインで足せます。

| グラフビュー | Vim |
| :---: | :---: |
| <img src="docs/images/readme/ja/plugin-graph.webp" alt="ノートとそのリンクをグラフで表示" width="420" /> | <img src="docs/images/readme/ja/plugin-vim.webp" alt="Vimのジャンプラベルと、ウィンドウバーのモード表示" width="420" /> |
| **クイックプレビュー** | **バージョン履歴** |
| <img src="docs/images/readme/ja/plugin-preview.webp" alt="リンクにポインタを置くと、リンク先のノートがカードで表示される" width="420" /> | <img src="docs/images/readme/ja/plugin-history.webp" alt="ノートの過去のバージョンを横に表示" width="420" /> |

マインドマップ、Marpのスライド、カンバン、タブで開くPDFとWord、Zoteroからの引用、さまざまなグラフなどは **設定 › 拡張機能** にあります。パソコンでもiPhoneとiPadでも使えます。

## よくある質問

<details>
<summary><strong>Textusは無料ですか？</strong></summary>

はい。MITライセンスのオープンソースで、アカウントもサブスクリプションも要りません。Textus AIの利用料は、選んだプロバイダーから直接請求されます。ローカルモデルなら費用はかかりません。

</details>

<details>
<summary><strong>どの環境で使えますか？</strong></summary>

macOS（AppleシリコンとIntel）、Windows、Linux、そしてApp StoreからiPhoneとiPadで使えます（中国本土を除く）。

</details>

<details>
<summary><strong>メモリはどれくらい使いますか？</strong></summary>

メモリ使用量はとても重視していて、リリースのたびに計測しています。ウィンドウ1つで約110 MB、ウィンドウを1つ増やすごとに約55 MB増えます。プラグインは使うときだけ読み込まれ、バックグラウンドに置いたWebページは解放されて、戻ったときに読み込み直されます。

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
