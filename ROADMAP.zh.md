# 路线图

[English](ROADMAP.md) · 每次发版更新，上次更新：1.4.4。

这里特意不写日期：我们人少，做好了再发。已经发布的内容见[更新说明](docs/releases/)。

## 1.4.4（收尾中）

- **插件接口 1.8** 第一部分：插件可以加导出格式、右键菜单、`/` 菜单里的块和片段、页边标记、带一键修复的问题提示、行内续写、只做显示的语法、页边批注，并在你同意后使用你的 AI 模型。
- **标题折叠**，以及 **Excalidraw** 插件。
- **动效和拖动**：块按它本身的样子拖动，其他块让出位置，也能拖进并排打开的文档；平滑滚动；表格行列展开、滑到位。
- **自定义 AI 接口**列出可选的模型，在设置和对话里都能选。[#700](https://github.com/CatVinci-Studio/Textus/issues/700) [#701](https://github.com/CatVinci-Studio/Textus/issues/701) [#702](https://github.com/CatVinci-Studio/Textus/issues/702)
- **公式多时也流畅**：公式、图表和嵌入的笔记只画在你正在读的附近。[#710](https://github.com/CatVinci-Studio/Textus/issues/710)
- **手机和平板**：用触摸拖动块，页面铺到屏幕底边。
- **1.4 之前的样子**随时可以换回：外观 › 窗口布局里有说明。

之后 **iPhone 和 iPad 上架 App Store**；在那之前用 [TestFlight 测试版](https://testflight.apple.com/join/39s9nnzs)和安卓 APK。

## 1.4.5

- **插件接口 1.8** 剩下的部分：插件自己的数据库视图、来自别处的文件夹（可读可写）、读取其他应用文件夹的约定、把 AI 回答流式交给插件。
- **通过 SSH 打开远端文件夹**，和 VS Code 一样：用你的 `~/.ssh/config` 和密钥，服务器上不用装东西。
- **安卓**：用"文件"App 打开的文件夹里，整个文件夹的搜索和数据库。

## 以后

其余的按大家的需求排：给 issue 点 👍 让它往前排，或者在[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)里留言。

## 不进核心，做成插件

App 本身保持精简。外部服务和较少用的语法都做成插件，在 **设置 › 插件** 里安装，在 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) 里开发。

已经有的插件：

- 外部服务：Zotero、Openverse 图片、WakaTime、DeepSeek，以及作为智能体的 Claude Code、Codex 和 OpenCode；
- 同步：Cloud Sync（WebDAV、S3、坚果云）；
- 语法和图表：LaTeX 补全、ABC 乐谱、PlantUML、WaveDrom、Markmap、ECharts 和 Chart.js、函数图像；
- 工作方式：看板、数据库、白板、Excalidraw、日记、任务、幻灯片、Vim 和 Emacs 键位等。

还没有、欢迎做成插件的：MkDocs / Zensical 提示块（[#220](https://github.com/CatVinci-Studio/Textus/issues/220)）、Cisco IOS 代码高亮（[#639](https://github.com/CatVinci-Studio/Textus/issues/639)）。

## 想帮忙？

挑一个还没人认领的 [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee)、[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) 或[插件点子](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22)，并阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。
