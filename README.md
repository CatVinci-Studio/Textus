<!-- The English README is the reference: every README.<lang>.md follows its
     structure section by section (scripts/check-readmes.mjs). It follows the
     website: hero, download, writing, Textus AI, privacy, questions. -->

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

| Platform              | Download                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| macOS · Apple Silicon | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| macOS · Intel         | [Download .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| Windows · x64         | [Download .exe](https://github.com/CatVinci-Studio/Textus/releases/latest)                            |
| Linux · x64           | [Download .AppImage](https://github.com/CatVinci-Studio/Textus/releases/latest) · Also as .deb · .rpm |

Or with Homebrew:

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux via the signed [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) pacman repository (once; `sudo pacman -Syu` then keeps Textus up to date):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

iPhone and iPad: coming soon. [All releases on GitHub](https://github.com/CatVinci-Studio/Textus/releases)

## Writing

Every Markdown mark, rendered as you write. Point at a line to see its Markdown.

<p align="center">
  <img src="docs/images/readme/en/markdown.png" alt="What you see is what you get." width="860" />
</p>

Math renders as you type, tables line up, and a few lines of text draw a diagram.

<p align="center">
  <img src="docs/images/readme/en/math.png" alt="Formulas, tables, diagrams – done in a snap." width="860" />
</p>

### Your writing style? Your call

Four writing modes, any theme you like – Typora themes included.

| Writing modes    | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| Zen Mode         | Everything but your words steps away                 |
| Typewriter Mode  | The line you are writing stays at the same height    |
| Split View       | Markdown on one side, the finished page on the other |
| Source Code Mode | The whole document as plain Markdown                 |

<p align="center">
  <img src="docs/images/readme/en/split.png" alt="Split View" width="49%" />
  <img src="docs/images/readme/en/zen.png" alt="Zen Mode" width="49%" />
</p>

Export to PDF, Word, HTML and more.

## Textus AI

Your writing assistant. It writes with you.

### While you write

Pause, and the next words appear in grey. Tab takes them. Typos and grammar are flagged as you write, along with your own conventions. Alt+Enter fixes them.

### When you ask

Edits arrive as proposals, each with a reason. Take one whole, or sentence by sentence. Comments pinned to the lines they mean. Notes, not rewrites. Tighten, proofread, translate, change the tone and more, one slash away.

### It knows you

It learns your style, remembers your characters and places, and follows your instructions.

### Any LLM you like

Textus works with more than 20 LLMs, and with any LLM that offers an OpenAI-compatible API.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · Any OpenAI-compatible endpoint

<p align="center">
  <img src="docs/images/readme/en/settings.png" alt="Any LLM you like." width="860" />
</p>

## What you write is yours alone

Your writing stays yours. Textus is built so that it can, and its code is open so that anyone can check.

Documents are plain Markdown files, kept wherever you choose. API keys and sign-ins are stored only on your computer. AI requests travel directly from your device to the provider you pick. Download it and write. There is nothing to sign up for. No analytics, no telemetry, no ads. MIT-licensed and public, line by line, so anyone can verify all of this. With a local model through Ollama, your words never leave your computer.

## Questions

<details>
<summary><strong>Is Textus free?</strong></summary>

Yes. It is free and open source under the MIT license, with no account and no subscription. If you use Textus AI, your provider bills you directly, or not at all with a local model.

</details>

<details>
<summary><strong>Which platforms does it run on?</strong></summary>

macOS (Apple Silicon and Intel), Windows and Linux. iPhone and iPad are coming.

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

## Quick start

1. Launch Textus. It opens on a blank draft; you only need a file when you save.
2. Open **Settings → Textus AI**, choose a provider, and sign in or paste a key under **Login & credentials**.
3. Start typing. A continuation appears in grey when you pause; Tab accepts it.
4. Open the AI panel with the chat button in the window bar. **Help → AI Features Guide** covers the rest.

Every shortcut is listed, and can be changed, in **Settings → Shortcuts**.

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
