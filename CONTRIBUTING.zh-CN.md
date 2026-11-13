# 参与 Textus

谢谢你愿意帮忙。Textus 由 CatVinci Studio 的几个人维护，每一个外部的修复和想法都很重要。用中文或英文联系我们都可以（[English](CONTRIBUTING.md)）。

## 从哪里开始

- **适合上手的 issue：** [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee) 和 [help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee)，先挑还没人认领的。在 issue 下评论 `/take` 认领（同时只能认领一个），机器人会把它分配给你。7 天内开一个草稿 PR；14 天没有动静会自动释放给别人。评论 `/untake` 可以主动放弃。
- **翻译：** 见 [docs/dev/translating.md](docs/dev/translating.md)。
- **想加新功能？** 先想想能不能做成插件：大多数新功能，以及所有接入外部服务的功能，都应该放在 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins)，而不是改 App。[路线图](ROADMAP.zh.md) 里列了哪些不进核心。
- **修 bug：** 直接提 PR。**给 App 加功能：** 先开 issue，商量好再动手。

改错字、修死链这类小改动不用开 issue，也不用认领。

## 搭建环境

需要 [Node.js](https://nodejs.org) 22 以上（见 `.nvmrc`）、用 rustup 安装的 [Rust](https://rustup.rs)（`src-tauri/rust-toolchain.toml` 会自动选版本），以及各平台的编译工具：macOS 装 Xcode Command Line Tools；Windows 装 "Desktop development with C++"；Debian/Ubuntu 运行 `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`。

```sh
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install
npm run tauri dev   # 完整的 App，前端热更新
npm run dev         # 只有前端，http://localhost:1420，后端是模拟的
```

官方插件从旁边一个名为 `textus-plugins` 的 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) 检出目录读取（或用 `TEXTUS_PLUGINS_DIR` 指定），在里面先运行一次 `npm ci`。所有开发文档见 [docs/README.md](docs/README.md)，目录结构见 [architecture.md](docs/dev/architecture.md)。

## 提交前

```sh
npm run check
```

PR 只需要这一条：类型、lint、单元测试、格式和代码形状规则。CI 在每个 PR 上跑同样的检查，改到 `src-tauri/` 时再加 Linux 上的 Rust 检查。e2e 和各平台的原生构建在每次发版前由维护者来跑。代码规范和对应的检查脚本见 [docs/dev/code-style.md](docs/dev/code-style.md)，新测试放在哪一层见 [testing.md](docs/dev/testing.md)。

## Pull request

- 提到 `main`，分支按内容命名（如 `fix/pdf-margins`）。我们用 squash 合并，所以标题用一句英文说清改了什么，描述写为什么改；用 `Closes #123` 关联 issue。
- 在 [docs/releases/next/](docs/releases/next/README.md) 里单独加一个更新说明文件；用户看不到的改动可以不加。
- 看得见的改动附截图或短录屏。如果改到窗口标题栏、红绿灯、拖动、全屏或快捷键，写一句，我们发版前会在真机 Mac 上检查。
- 用 AI 写的 PR 也欢迎，但请自己读懂每一行，并写清楚测了什么。AI 助手会读 [AGENTS.md](AGENTS.md)。
- 不要改 CI 和测试配置；从 fork 改 `.github/` 会故意让 `ci-config` 检查失败，由维护者接手。

issue 我们一周内回复，PR 3 天内回复。没回的话在 PR 下提醒我们，多半是漏看了。很多时候我们会把 PR 合进自己的分支，小问题由我们来修，而不是退回给你改。

## 卡住了？

直接问。可以开一个带问题的草稿 PR 或 issue，也可以在 [Discord](https://textus.md/discord)（英文）或 README 里的 QQ 群、微信群（中文）找我们。带着问题的半成品，好过方向做错了的成品。
