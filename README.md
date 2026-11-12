<!-- The English README is the reference: every README.<lang>.md follows its
     structure section by section (scripts/check-readmes.mjs). -->

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>The next-generation Integrated Writing Environment.</strong><br>
  AI keeps your ink flowing. You hold the pen.
</p>

<p align="center">
  <a href="https://textus.md"><strong>Website</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Download</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/issues/648"><strong>Sponsor</strong></a>
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
  <a href="https://textus.md/discord"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/jaywcjlove/awesome-mac"><img alt="Awesome Mac" src="https://img.shields.io/badge/Awesome-Mac-FC60A8?logo=awesomelists&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/307610?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-307610" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/307610/daily?language=TypeScript" alt="CatVinci-Studio%2FTextus | Trendshift" width="250" height="55"/></a>
</p>

<p align="center"><strong>Premier Sponsor</strong></p>

<p align="center">
  <a href="https://www.anthropic.com/">
    <img src="docs/images/readme/sponsors/anthropic-logo-slate.png#gh-light-mode-only" alt="Anthropic" width="240">
    <img src="docs/images/readme/sponsors/anthropic-logo-ivory.png#gh-dark-mode-only" alt="Anthropic" width="240">
  </a>
</p>

<p align="center"><sub>through the Anthropic Startup Program</sub></p>

<p align="center"><sub>Sponsors: <a href="https://github.com/jzzzzh"><img src="https://github.com/jzzzzh.png?size=40" alt="" width="20" height="20" align="center"> Jiang Zhuohang</a></sub></p>

<p align="center">
  <img src="docs/images/readme/en/hero.webp" alt="Textus with the first chapter of A Study in Scarlet beside the reader’s notes on it. Textus AI suggests revisions to the notes in the margin and pins a review comment beside the novel." width="860" /><br>
  <sub><i>A Study in Scarlet</i>, Arthur Conan Doyle (1887)</sub>
</p>

## Get Textus

Free and open source, under the MIT license.

| Platform              | Download                                                                                              | Other ways to install                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS · Apple Silicon | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | Homebrew: `brew install --cask textus`                                              |
| macOS · Intel         | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | Homebrew: `brew install --cask textus`                                              |
| Windows · x64         | [Download .exe](https://github.com/CatVinci-Studio/Textus/releases/latest)                            | —                                                                                   |
| Linux · x64           | [Download .AppImage](https://github.com/CatVinci-Studio/Textus/releases/latest) · Also as .deb · .rpm | Arch Linux: the [`[catvinci]` repository](https://github.com/CatVinci-Studio/arch-repo) |

> iPhone and iPad: on the App Store soon.

Beta: in **Settings › About**, set **Update channel** to **Beta**.

## Why Textus

Programmers have IDEs: one place where writing code, checking it and their tools come together. Writers usually borrow a code editor or juggle several apps. Textus brings the whole writing process into one place.

- **Markdown as the common language.** In the AI era, Markdown is more than a file format: people, AI and other tools all read it, so your work moves freely between them.
- **Built around writing, not code.** Drafting, reviewing and revising come first, not features added to a code editor.
- **AI made for writing.** Suggestions while you write, comments while you review, and revisions you accept or reject one by one.
- **Arranged your way.** WYSIWYG editing, a rich plugin system, sync, even your daily plans: take what you need and leave the rest.
- **Comes with your notes.** Open an Obsidian vault as it is, import from Notion, and use Typora themes.

## Writing

What you see is what you get: Markdown laid out as you type, with tables, code, math and diagrams, and drafts, notes and sources side by side. Export to PDF, Word, HTML and more.

<p align="center">
  <img src="docs/images/readme/en/writing.webp" alt="Textus with several documents side by side: tables, a code block, math and a diagram laid out as they are typed" width="860" />
</p>

## Textus AI

Works with online and local models, and joins the writing itself.

| Continuation | Typos and grammar |
| :---: | :---: |
| <img src="docs/images/readme/en/ai-continue.webp" alt="The next words in grey when you pause; Tab takes them" width="420" /> | <img src="docs/images/readme/en/ai-grammar.webp" alt="A slip underlined, fixed with Alt+Enter" width="420" /> |
| **Proposed edits** | **Review comments** |
| <img src="docs/images/readme/en/ai-revise.webp" alt="Edits sentence by sentence, each with its reason" width="420" /> | <img src="docs/images/readme/en/ai-review.webp" alt="A comment pinned to its sentence" width="420" /> |
| **Slash skills** | **Any model** |
| <img src="docs/images/readme/en/ai-skills.webp" alt="The skills menu, opened with /" width="420" /> | <img src="docs/images/readme/en/ai-models.webp" alt="Choosing a provider in Settings" width="420" /> |

For advanced use, connect MCP servers, or bring Claude Code and Codex into the AI panel as agents.

## Plugins

| Graph View | Version History |
| :---: | :---: |
| <img src="docs/images/readme/en/plugin-graph.webp" alt="Notes and their links drawn as a graph" width="420" /> | <img src="docs/images/readme/en/plugin-history.webp" alt="A note's earlier versions beside it" width="420" /> |
| **Quick Preview** | **Knowledge Base** |
| <img src="docs/images/readme/en/plugin-preview.webp" alt="Resting on a link shows that note in a card" width="420" /> | <img src="docs/images/readme/en/plugin-database.webp" alt="A Notion-style page: its entries as a table, each a note with its properties" width="420" /> |

More plugins and themes: [textus.md/extensions](https://textus.md/extensions/).

## Sponsors

**Premier Sponsor:** [Anthropic](https://www.anthropic.com/), through the Anthropic Startup Program.

**Sponsors:** [Jiang Zhuohang](https://github.com/jzzzzh)

Textus is free and open source. [Sponsor us](https://github.com/CatVinci-Studio/Textus/issues/648) to support its development.

## Community

Join us on Discord, QQ or WeChat: [textus.md/community](https://textus.md/community/). Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues). To contribute code, start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Questions

<details>
<summary><strong>Is Textus free?</strong></summary>

Yes, and it always will be. It is open source under the MIT license, with no account and no subscription. If you use Textus AI, your provider bills you directly, or not at all with a local model.

</details>

<details>
<summary><strong>Which platforms does it run on?</strong></summary>

macOS (Apple Silicon and Intel), Windows and Linux, and iPhone and iPad from the App Store.

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

## Star history

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## License

[MIT](./LICENSE) © CatVinci Studio
