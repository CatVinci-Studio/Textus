<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>下一代 Markdown 编辑器</strong><br>
  下笔成章，AI 研墨
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>官网</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>下载</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  简体中文 ·
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
  <a href="https://textus.catvinci.com/qq"><img alt="QQ" src="https://img.shields.io/badge/QQ-1128285004-12B7F5?logo=qq&logoColor=white"></a>
  <a href="https://textus.catvinci.com/wechat"><img alt="WeChat" src="https://img.shields.io/badge/WeChat-group-07C160?logo=wechat&logoColor=white"></a>
  <a href="https://github.com/jaywcjlove/awesome-mac"><img alt="Awesome Mac" src="https://img.shields.io/badge/Awesome-Mac-FC60A8?logo=awesomelists&logoColor=white"></a>
</p>

https://github.com/user-attachments/assets/56473ad9-5cb0-4608-b3c8-30882420edcd

<p align="center">
  <img src="docs/images/readme/zh/hero.png" alt="Textus 打开着《红楼梦》和一段读书笔记，Textus AI 逐句精简笔记，每处修改都在页边，并在原文旁钉上审阅批注" width="860" /><br>
  <sub>《红楼梦》曹雪芹</sub>
</p>

## 开始使用 Textus

免费开源，采用 MIT 协议。

| 平台               | 下载                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------ |
| macOS · Apple 芯片 | [下载 .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| macOS · Intel    | [下载 .dmg](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| Windows · x64    | [下载 .exe](https://github.com/CatVinci-Studio/Textus/releases/latest)                       |
| Linux · x64      | [下载 .AppImage](https://github.com/CatVinci-Studio/Textus/releases/latest) · 另有 .deb · .rpm |

或用 Homebrew 安装：

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux 可以使用带签名的 [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) pacman 软件源（只需设置一次，之后 `sudo pacman -Syu` 会让 Textus 保持最新）：

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

iPhone 与 iPad 版即将推出。[在 GitHub 查看所有版本](https://github.com/CatVinci-Studio/Textus/releases)

## 写作

每一种 Markdown 标记，边写边排好。指向任意一行，就能看到它的源码。

<p align="center">
  <img src="docs/images/readme/zh/markdown.png" alt="所见即所得" width="860" />
</p>

公式边打边出，表格自动对齐，几行文字就能画出图表。

<p align="center">
  <img src="docs/images/readme/zh/math.png" alt="公式、表格、图表，一键搞定" width="860" />
</p>

### 写作风格？随你喜欢

四种写作模式随心切换，主题一键更换，Typora 主题也能直接用。

| 写作模式  | 作用                  |
| ----- | ------------------- |
| 禅模式   | 除了文字，其余一切都退到幕后      |
| 打字机模式 | 正在写的那一行始终停在同一高度     |
| 分屏视图  | 一边写 Markdown，一边看排版  |
| 源码模式  | 整篇文档以 Markdown 原文呈现 |

<p align="center">
  <img src="docs/images/readme/zh/split.png" alt="分屏视图" width="49%" />
  <img src="docs/images/readme/zh/zen.png" alt="禅模式" width="49%" />
</p>

导出为 PDF、Word、HTML 等格式。

## Textus AI

你的写作助手，和你一起写。

### 写的时候

停下笔，灰色的下文便会出现，按 Tab 收下。边写边标出错字和语病，也会对照你的写作规范。按 Alt+Enter 即可修正。

### 需要帮忙时

修改以提议的形式出现，各附理由。可以整段采纳，也可以逐句取舍。批注钉在对应的句子旁。只提意见，不改你的稿。精简、校对、翻译、换个语气……输入斜杠即可调用。

### 懂你

学习你的文风，记住你笔下的人物与地点，遵循你定下的写作要求。

### 不同 LLM，随你喜欢

Textus 支持超过 20 种不同的 LLM，以及任何提供 OpenAI 兼容接口的 LLM。

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · 任何兼容 OpenAI 接口的服务

<p align="center">
  <img src="docs/images/readme/zh/settings.png" alt="不同 LLM，随你喜欢" width="860" />
</p>

## 你写的东西，只属于你

你写的东西只属于你。Textus 从设计上保证这一点，代码公开，任何人都能核实。

文档是普通的 Markdown 文件，放在你选的位置。API Key 和登录信息只保存在你的电脑上。AI 请求从你的设备直接发往你选择的服务商。下载就能写，没有任何需要注册的东西。没有统计，没有遥测，没有广告。以 MIT 协议公开每一行代码，上面这些，任何人都能核实。 通过 Ollama 使用本地模型时，你的文字从不离开你的电脑。

## 常见问题

<details>
<summary><strong>Textus 免费吗？</strong></summary>

免费。Textus 以 MIT 协议开源，不需要账号，也没有订阅。如果使用 Textus AI，费用由你选择的服务商直接结算；使用本地模型则完全免费。

</details>

<details>
<summary><strong>支持哪些平台？</strong></summary>

支持 macOS（Apple 芯片和 Intel）、Windows 和 Linux。iPhone 与 iPad 版即将推出。

</details>

<details>
<summary><strong>需要 AI 账号吗？</strong></summary>

不需要。不用 AI，编辑器的全部功能照样可用。想用 Textus AI，就接入你自己的服务商：用 ChatGPT 或 Claude 账号登录、填入 API Key，或用 Ollama 运行本地模型。

</details>

<details>
<summary><strong>可以离线使用吗？</strong></summary>

编辑器完全可以离线使用。Textus AI 需要连接你的服务商，运行本地模型时则无需联网。

</details>

<details>
<summary><strong>是标准 Markdown 吗？能导出什么格式？</strong></summary>

是的，就是普通的 .md 文件，支持表格、任务列表、脚注、公式和 Mermaid。可以导出为 PDF、Word、HTML 等格式。

</details>

## 快速上手

1. 打开 Textus。它从一份空白草稿开始，保存时才需要选择文件。
2. 打开 **设置 → Textus AI**，选择服务商，在 **登录与凭据** 中登录或填入密钥。
3. 开始写作。停笔时，续写会以灰色文字出现，按 Tab 采纳。
4. 点窗口栏里的对话按钮打开 AI 面板。其余功能见 **帮助 → AI 功能指南**。

所有快捷键都可以在 **设置 → 快捷键** 中查看和修改。

## 社区

- [QQ 群](https://textus.catvinci.com/qq)：1128285004
- [微信群](https://textus.catvinci.com/wechat)：扫码加入（二维码每周更新）
- [Discord](https://textus.catvinci.com/discord)：英文交流

bug 反馈和功能建议也欢迎提到 [GitHub Issues](https://github.com/CatVinci-Studio/Textus/issues)。

## 路线图与参与开发

Textus 接下来的方向见 [路线图](ROADMAP.zh.md)。想自己构建 Textus、运行检查或提交 PR，请从 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）开始；AI 编程助手请遵循 [AGENTS.md](AGENTS.md)。讨论可以用中文或英文。

## Star 增长趋势

<a href="https://star-history.com/#CatVinci-Studio/Textus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date&theme=dark">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=CatVinci-Studio/Textus&type=Date">
  </picture>
</a>

## 许可证

[MIT](./LICENSE) © CatVinci Studio
