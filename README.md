<!-- The English README is the reference: every README.<lang>.md follows its
     structure section by section (scripts/check-readmes.mjs): hero, download,
     writing, Textus AI, plugins, questions. -->

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>The next-generation Markdown editor.</strong><br>
  You hold the pen. AI keeps your ink flowing.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Website</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Download</strong></a>
</p>

<p align="center">
  English ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
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
  <a href="https://www.youtube.com/watch?v=k_ew9TRljz0">Watch on YouTube</a> ·
  <a href="https://www.bilibili.com/video/BV19LJb6WEWb">Bilibili</a>
</p>

<p align="center">
  <img src="docs/images/readme/en/hero.png" alt="Textus with Hamlet and the reader’s notes on it open. Textus AI tightens the notes sentence by sentence, each change in the margin, and pins a review note beside the play." width="860" /><br>
  <sub><i>Hamlet</i>, William Shakespeare</sub>
</p>

## Get Textus

Free and open source, under the MIT license.

| Platform              | Download                                                                                              | Other ways to install                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS · Apple Silicon | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | Homebrew: `brew install --cask textus`                                              |
| macOS · Intel         | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | Homebrew: `brew install --cask textus`                                              |
| Windows · x64         | [Download .exe](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | —                                                                                   |
| Linux · x64           | [Download .AppImage](https://github.com/CatVinci-Studio/Textus/releases/latest) · Also as .deb · .rpm | Arch Linux: the [`[catvinci]` repository](https://github.com/CatVinci-Studio/arch-repo) |

> iPhone and iPad: on the App Store soon (not yet in mainland China).

Beta: in **Settings › General › About Textus**, set **Update channel** to **Beta**.

## Writing

What you see is what you get, laid out with Markdown as you type. Export to PDF, Word, HTML and more.

<p align="center">
  <img src="docs/images/readme/en/markdown.webp" alt="A document using every kind of Markdown mark - headings, bold and italic, quotes, lists, tasks, links, a note - all laid out" width="860" />
</p>

| Code blocks | Tables |
| :---: | :---: |
| <img src="docs/images/readme/en/code.webp" alt="A code block, coloured for its language" width="420" /> | <img src="docs/images/readme/en/table.webp" alt="A table, its columns lined up" width="420" /> |
| **Math** | **Diagrams** |
| <img src="docs/images/readme/en/formula.webp" alt="Formulas drawn as you type them" width="420" /> | <img src="docs/images/readme/en/diagram.webp" alt="A Mermaid flowchart" width="420" /> |

## Textus AI

Works with online and local LLMs alike - AI that speeds your writing along.

| Continuation | Typos and grammar | Proposed edits |
| :---: | :---: | :---: |
| <img src="docs/images/readme/en/ai-continue.webp" alt="The next words in grey when you pause; Tab takes them" width="280" /> | <img src="docs/images/readme/en/ai-grammar.webp" alt="A slip underlined, fixed with Alt+Enter" width="280" /> | <img src="docs/images/readme/en/ai-revise.webp" alt="Edits sentence by sentence, each with its reason" width="280" /> |
| **Review comments** | **Slash skills** | **Any model** |
| <img src="docs/images/readme/en/ai-review.webp" alt="A comment pinned to its sentence" width="280" /> | <img src="docs/images/readme/en/ai-skills.webp" alt="The skills menu, opened with /" width="280" /> | <img src="docs/images/readme/en/ai-models.webp" alt="Choosing a provider in Settings" width="280" /> |

## Plugins

Not just writing: plugins add whatever else you need.

| Graph View | Vim |
| :---: | :---: |
| <img src="docs/images/readme/en/plugin-graph.webp" alt="Notes and their links drawn as a graph" width="420" /> | <img src="docs/images/readme/en/plugin-vim.webp" alt="Vim's flash labels and its mode in the window bar" width="420" /> |
| **Quick Preview** | **Version History** |
| <img src="docs/images/readme/en/plugin-preview.webp" alt="Resting on a link shows that note in a card" width="420" /> | <img src="docs/images/readme/en/plugin-history.webp" alt="A note's earlier versions beside it" width="420" /> |

Mind maps, Marp slides, Kanban boards, PDF and Word in a tab, Zotero citations, charts of every kind and more are in **Settings › Extensions**, on the computer and on iPhone and iPad.

## Questions

<details>
<summary><strong>Is Textus free?</strong></summary>

Yes. It is free and open source under the MIT license, with no account and no subscription. If you use Textus AI, your provider bills you directly, or not at all with a local model.

</details>

<details>
<summary><strong>Which platforms does it run on?</strong></summary>

macOS (Apple Silicon and Intel), Windows and Linux, and iPhone and iPad from the App Store (not yet in mainland China).

</details>

<details>
<summary><strong>How much memory does it use?</strong></summary>

We care a great deal about memory and measure it in every release. A window takes about 110 MB, and each further window about 55 MB more. Plugins load only when they are used, and a web page left in the background is let go and loads again when you come back to it.

</details>

<details>
<summary><strong>Do I need an AI account?</strong></summary>

No. The editor works fully without AI. For Textus AI, connect a provider of your own: sign in with ChatGPT or Claude, add an API key, or run a local model with Ollama.

</details>

<details>
<summary><strong>Does it work offline?</strong></summary>

The editor does, completely. Textus AI needs your provider, unless you run a local model.

</details>

<details>
<summary><strong>Is it plain Markdown? What can I export?</strong></summary>

Yes: plain .md files, with tables, task lists, footnotes, math and Mermaid. You can export to PDF, Word, HTML and more.

</details>

## Community

- [Discord](https://textus.catvinci.com/discord): announcements, help and feedback, in English.
- Chinese-speaking: [QQ group](https://textus.catvinci.com/qq) (1128285004) · [WeChat group](https://textus.catvinci.com/wechat)

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues).

## Roadmap and contributing

[ROADMAP.md](ROADMAP.md) shows where Textus is heading. To build Textus, run the checks or open a pull request, start with [CONTRIBUTING.md](CONTRIBUTING.md); AI coding assistants follow [AGENTS.md](AGENTS.md). Discussions are welcome in English or Chinese.

## Star history

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## License

[MIT](./LICENSE) © CatVinci Studio
