# 路线图

[English](ROADMAP.md)

这里写的是我们正在做的事，和接下来想做的事。没有写日期是故意的：我们是个小团队，宁愿等东西做好了再发，也不想赶着日期交差。

每一项都有一个带 [`roadmap`](https://github.com/CatVinci-Studio/Textus/labels/roadmap) 标签的 issue。哪一项对你特别重要，就去那里说一声，真的会影响我们先做哪个。

## 正在做的

**上架 App Store。** iPhone 和 iPad 版已经在 TestFlight 里测试了一段时间，马上就要提交审核。
[#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## 下一个版本（1.2.0）

Textus AI 能做的更多，编辑器更顺手，也修了很多问题。

- **在侧边栏打开整个文件夹**，并用 `Ctrl/⌘ + Shift + O` 搜索里面的文件名。[#152](https://github.com/CatVinci-Studio/Textus/issues/152)、[#79](https://github.com/CatVinci-Studio/Textus/issues/79)
- **保存时只改你编辑过的地方。** 没动过的段落按原样写回，和 Git 一起用时改动一目了然。双链（`[[笔记]]`、`[[笔记#标题]]`）可以点开，双链和 `#标签` 都原样保存。[#234](https://github.com/CatVinci-Studio/Textus/pull/234)
- **修订边生成边一处一处出现。** 每一句改动直接出现在原来的位置，边注卡片同时出现，修订条上的处数跟着增加。[#243](https://github.com/CatVinci-Studio/Textus/pull/243)
- **Textus AI 画的图边写边画出来**，采纳前就能看到。[#254](https://github.com/CatVinci-Studio/Textus/pull/254)
- **Textus AI 能读更多项目文件夹里的东西**：长文件分段读，Word、PDF、幻灯片和表格，模型能看图时还能看图片；能按文件名找文件，跳过 `.gitignore` 里写的文件。
- **Textus AI 联网搜索**，所有 AI 服务都能用，来源编号列出、可以查证，也可以变成脚注。
- **深度思考按钮**，和联网搜索按钮并排。
- **Textus AI 生成图片**，像其他提议一样由你确认，支持国内外主流的图片服务。[#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **Textus AI 从你拒绝的修订里学习**，你一再拒绝的修改，它会提议记下来。
- **豆包（火山引擎）** 成为内置的 AI 服务。
- **长文档**打开、滚动、打字都流畅。
- **动画更流畅**：动画、滚动和面板在各个平台上都不卡顿。
- **无障碍**：支持读屏软件、完全用键盘操作和高对比度。
- **在后台保持运行**（需要手动打开），在通知区域、系统托盘或菜单栏显示图标。[#244](https://github.com/CatVinci-Studio/Textus/pull/244)
- **跳到其他文件里的标题**（[#233](https://github.com/CatVinci-Studio/Textus/pull/233)），重新打开文档时回到上次的位置（[#218](https://github.com/CatVinci-Studio/Textus/issues/218)）。
- **更多快捷键**、**界面文字大小**、代码块的**复制**按钮和行号、颜色代码前的**色块**，以及可选的**图表引擎**（Mermaid，或更快的 Pele）。[#214](https://github.com/CatVinci-Studio/Textus/issues/214)、[#150](https://github.com/CatVinci-Studio/Textus/issues/150)、[#146](https://github.com/CatVinci-Studio/Textus/issues/146)、[#242](https://github.com/CatVinci-Studio/Textus/pull/242)

## 最近完成

- **Textus 1.1.0**：Textus AI 的三种模式：写作、审阅、修订（[#179](https://github.com/CatVinci-Studio/Textus/pull/179)），会记住你要求的 Textus AI（[#180](https://github.com/CatVinci-Studio/Textus/pull/180)），在对话里做主题，全新的新手教程（[#90](https://github.com/CatVinci-Studio/Textus/issues/90)），Windows 和 Linux 的原生 ARM64 安装包，设为默认 Markdown 编辑器（[#183](https://github.com/CatVinci-Studio/Textus/issues/183)），文档里支持更多 HTML，测试版通道，自动保存（[#133](https://github.com/CatVinci-Studio/Textus/issues/133)），在 App 里使用主题分享平台（[#89](https://github.com/CatVinci-Studio/Textus/issues/89)），`![[image.png]]` 形式的图片嵌入（[#135](https://github.com/CatVinci-Studio/Textus/issues/135)），以及自选图片文件夹或图床（[#147](https://github.com/CatVinci-Studio/Textus/issues/147)）。
- **Textus 1.1.1**：修订的高亮更柔和；加载不了的图片显示一张说明卡片；图片右键可以**在文件夹中显示**；图片宽度改用其他应用也认的写法；修好了输入的链接和图片（[#189](https://github.com/CatVinci-Studio/Textus/issues/189)）、打字机模式下的点击（[#217](https://github.com/CatVinci-Studio/Textus/issues/217)）和最近打开（[#201](https://github.com/CatVinci-Studio/Textus/issues/201)）。
- **Playground 已上线**：[textus.catvinci.com/playground](https://textus.catvinci.com/playground/)，不用安装就能在浏览器里试试编辑器。[#88](https://github.com/CatVinci-Studio/Textus/issues/88)
- **主题分享已开放**：在置顶的 issue 里发一条评论，我们看过之后，你的主题就会出现在 [textus.catvinci.com/themes](https://textus.catvinci.com/themes/) 上，大家都能免费下载。[#89](https://github.com/CatVinci-Studio/Textus/issues/89)

## 以后：Textus 1.3.0，插件

- **插件、插件分享平台和 MCP 分享平台**，Textus AI 也能帮你写插件。每个插件都要遵守这些要求：
  - 在沙盒里运行，只拿到你安装时允许的权限（读写某个文件夹、联网），更新后要更多权限会重新问你。
  - 不装就不会运行；一个总开关能关掉所有插件，关掉后就和没有插件一样。
  - 装好的插件在你第一次用到时才加载：装多少个，启动都和一个没装时一样快。
  - 出错或拖慢 Textus 的插件会自动停用，并告诉你原因。
  - Textus AI 只有在你允许时才会用插件，而且只能读取或提议：改你的文档仍然是由你确认的提议。
  - 分享平台上的插件和主题一样，由我们看过之后才会上架，发现有害的可以下架。
- **第一批官方插件**，每一个都和 Textus 本身一样用心做好看：随时速记（[#193](https://github.com/CatVinci-Studio/Textus/issues/193)）、文档的版本历史、SVG 和 PDF 阅读器、图片查看器、日历和每日笔记、任务、看板，以及用于引用文献的 Zotero。
- **第二版插件接口**，按第一批插件的实际需要来补。

## 想帮忙？

带 [`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue) 标签的 issue 适合上手。如果你有这里没写到的想法，到[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)许个愿，或者给已有的愿望点个 👍。每一条我们都会看，呼声高的会放进这里。怎么构建 Textus、怎么提 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。
