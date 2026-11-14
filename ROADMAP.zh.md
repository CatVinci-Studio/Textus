# 路线图

[English](ROADMAP.md) · 每个小版本更新一次，上次更新：1.4.1。

这里特意不写日期：我们人少，做好了再发。已经发布的内容见[更新说明](docs/releases/)。

## 现在（1.4.x）

- **查找替换**在各种情况下都可靠。[#668](https://github.com/CatVinci-Studio/Textus/issues/668)
- **大表格**可以调整宽度。[#645](https://github.com/CatVinci-Studio/Textus/issues/645)
- **Linux**：降低内存占用，窗口加阴影、标题栏更宽松。[#644](https://github.com/CatVinci-Studio/Textus/issues/644)、[#664](https://github.com/CatVinci-Studio/Textus/issues/664)
- **iOS 公测**通过 TestFlight 开放，Android 版随每个版本提供 APK。[#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## 下一个（1.5）

- **iPad 使用桌面版界面**，iPhone 在此基础上适配。
- **更轻的窗口**：窗口的每个区域只用一个编辑器，文档以数据保存，开很多标签页也不怎么占内存。
- **语音输入。**[#195](https://github.com/CatVinci-Studio/Textus/issues/195)

## 以后

其余的按大家的需求排：给 issue 点 👍 让它往前排，或者在[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)里留言。

## 不进核心，做成插件

App 本身保持精简。外部服务和较少用的语法都做成插件，在 **设置 › 插件** 里安装，在 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) 里开发。

已经有的插件：

- 外部服务：Zotero、Openverse 图片、WakaTime、DeepSeek，以及作为智能体的 Claude Code、Codex 和 OpenCode；
- 同步：Cloud Sync（WebDAV、S3、坚果云）；
- 语法和图表：LaTeX 补全、ABC 乐谱、PlantUML、WaveDrom、Markmap、ECharts 和 Chart.js、函数图像；
- 工作方式：看板、数据库、白板、日记、任务、幻灯片、Vim 和 Emacs 键位等。

还没有、欢迎做成插件的：MkDocs / Zensical 提示块（[#220](https://github.com/CatVinci-Studio/Textus/issues/220)）、Cisco IOS 代码高亮（[#639](https://github.com/CatVinci-Studio/Textus/issues/639)）。

## 想帮忙？

挑一个还没人认领的 [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee)、[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) 或[插件点子](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22)，并阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。
