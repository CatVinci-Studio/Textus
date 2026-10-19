# 路线图

[English](ROADMAP.md)

这里写的是我们正在做的事，和接下来想做的事。没有写日期是故意的：我们是个小团队，宁愿等东西做好了再发，也不想赶着日期交差。

每一项都有一个带 [`roadmap`](https://github.com/CatVinci-Studio/Textus/labels/roadmap) 标签的 issue。哪一项对你特别重要，就去那里说一声，真的会影响我们先做哪个。

## 正在做的

**上架 App Store。** iPhone 和 iPad 版已经在 TestFlight 里测试了一段时间，马上就要提交审核。
[#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## 下一个版本（1.2.0）

- **随时速记。** 从文件菜单、托盘图标，或者你打开的全局快捷键弹出一个小小的 Markdown 窗口，写几句，按 `Esc` 就存成 Markdown 文件，可以每条一个文件，也可以每天一个文件。[#193](https://github.com/CatVinci-Studio/Textus/issues/193)
- **在后台保持运行**（需要手动打开）：关掉最后一个窗口后 Textus 继续运行，在通知区域、系统托盘或菜单栏显示图标，还可以登录时自动启动。[#244](https://github.com/CatVinci-Studio/Textus/pull/244)
- **在侧边栏打开整个文件夹**，并用 `Ctrl/⌘ + Shift + O` 搜索里面的文件名。[#152](https://github.com/CatVinci-Studio/Textus/issues/152)、[#79](https://github.com/CatVinci-Studio/Textus/issues/79)
- **保存时只改你编辑过的地方。** 没动过的段落按原样写回，和 Git 一起用时改动一目了然。双链（`[[笔记]]`、`[[笔记#标题]]`）可以点开，双链和 `#标签` 都原样保存。[#234](https://github.com/CatVinci-Studio/Textus/pull/234)
- **修订边生成边逐句出现。** 每一句改动直接出现在原句旁边，不再先把整段划掉。[#243](https://github.com/CatVinci-Studio/Textus/pull/243)
- **跳到其他文件里的标题**：`[参见](notes.md#标题)` 这样的链接会打开到那个标题。[#233](https://github.com/CatVinci-Studio/Textus/pull/233)
- **文档重新打开时回到上次编辑的位置**，光标也在原处。[#218](https://github.com/CatVinci-Studio/Textus/issues/218)
- **更多快捷键**：下一个、上一个标签页，标题 1 到 6 和正文，另外列出了不能修改的快捷键。[#214](https://github.com/CatVinci-Studio/Textus/issues/214)
- **界面文字大小**：放大或缩小侧边栏、标签页、菜单和 AI 面板的文字，文档本身不跟着缩放。[#150](https://github.com/CatVinci-Studio/Textus/issues/150)
- **颜色色块**：行内代码里的颜色值旁边显示对应颜色；代码块加了**复制**按钮和可选的行号。[#146](https://github.com/CatVinci-Studio/Textus/issues/146)
- **可选的图表引擎。** 默认仍是 Mermaid；Pele 画同样的图表更快。[#242](https://github.com/CatVinci-Studio/Textus/pull/242)

新功能放在这样的中版本里发布；补丁版本（1.2.x）只修问题。

## 最近完成

- **Textus 1.1.0**：Textus AI 的三种模式：写作、审阅、修订（[#179](https://github.com/CatVinci-Studio/Textus/pull/179)），会记住你要求的 Textus AI（[#180](https://github.com/CatVinci-Studio/Textus/pull/180)），在对话里做主题，全新的新手教程（[#90](https://github.com/CatVinci-Studio/Textus/issues/90)），Windows 和 Linux 的原生 ARM64 安装包，设为默认 Markdown 编辑器（[#183](https://github.com/CatVinci-Studio/Textus/issues/183)），文档里支持更多 HTML，测试版通道，自动保存（[#133](https://github.com/CatVinci-Studio/Textus/issues/133)），在 App 里使用主题分享平台（[#89](https://github.com/CatVinci-Studio/Textus/issues/89)），`![[image.png]]` 形式的图片嵌入（[#135](https://github.com/CatVinci-Studio/Textus/issues/135)），以及自选图片文件夹或图床（[#147](https://github.com/CatVinci-Studio/Textus/issues/147)）。
- **Textus 1.1.1**：修订的高亮更柔和；加载不了的图片显示一张说明卡片；图片右键可以**在文件夹中显示**；图片宽度改用其他应用也认的写法；修好了输入的链接和图片（[#189](https://github.com/CatVinci-Studio/Textus/issues/189)）、打字机模式下的点击（[#217](https://github.com/CatVinci-Studio/Textus/issues/217)）和最近打开（[#201](https://github.com/CatVinci-Studio/Textus/issues/201)）。
- **Playground 已上线**：[textus.catvinci.com/playground](https://textus.catvinci.com/playground/)，不用安装就能在浏览器里试试编辑器。[#88](https://github.com/CatVinci-Studio/Textus/issues/88)
- **主题分享已开放**：在置顶的 issue 里发一条评论，我们看过之后，你的主题就会出现在 [textus.catvinci.com/themes](https://textus.catvinci.com/themes/) 上，大家都能免费下载。[#89](https://github.com/CatVinci-Studio/Textus/issues/89)

## 以后：Textus 1.3.0

- **Textus AI 生成图片。** 写作时让它画插图、示意图，像其他提议一样确认后插进文档；支持国内外主流的图片服务。[#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **插件和插件分享平台**，和主题分享平台一样。插件在沙盒里运行，只拿到你允许的权限，不装就不会运行；Textus AI 也能帮你写一个或改一个，就像 `/theme` 做主题那样。
- **Textus AI 能读项目文件夹里的 Word、PDF、幻灯片和表格。**

## 以后：Textus 1.4.0

- **语音输入**，慢慢打磨，做好再发。[#195](https://github.com/CatVinci-Studio/Textus/issues/195)
- **第一批官方插件**：日记和日历、任务、看板。
- **文档的版本历史。**

## 想帮忙？

带 [`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue) 标签的 issue 适合上手。如果你有这里没写到的想法，到[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)许个愿，或者给已有的愿望点个 👍。每一条我们都会看，呼声高的会放进这里。怎么构建 Textus、怎么提 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。
