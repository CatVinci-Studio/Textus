# 路线图

[English](ROADMAP.md)

这里写的是我们正在做的事，和接下来想做的事。没有写日期是故意的：我们是个小团队，宁愿等东西做好了再发，也不想赶着日期交差。

每一项都有一个带 [`roadmap`](https://github.com/CatVinci-Studio/Textus/labels/roadmap) 标签的 issue。哪一项对你特别重要，就去那里说一声，真的会影响我们先做哪个。

## 正在做的

**上架 App Store。** iPhone 和 iPad 版已经在 TestFlight 里测试了一段时间，马上就要提交审核。
[#87](https://github.com/CatVinci-Studio/Textus/issues/87)

## 下一个版本（1.1.0）

- **Textus AI 的三种模式。** **写作**往文档里起草新内容，不改动已有的文字；**审阅**回答问题、在页边留批注；**修订**逐句提出修改。每一处改动都由你决定接受还是拒绝。[#179](https://github.com/CatVinci-Studio/Textus/pull/179)
- **Textus AI 会记住你的要求。** 告诉它一件以后也要遵守的事，比如用词习惯、语气、人物设定，它会记下来，可以只对这个项目，也可以对所有文档。记住的内容都能查看、修改和删除。[#180](https://github.com/CatVinci-Studio/Textus/pull/180)
- **在对话里做主题。** 输入 `/theme`，描述你想要的样子，一键换上。
- **全新的新手教程**，用一篇你所用语言的经典名著读书笔记来练习：亲手输入每种 Markdown 标记，连接 AI，再用 AI 写作、审阅、修订你自己的笔记。跳过 AI 也能看到这几课，还有动画演示。[#90](https://github.com/CatVinci-Studio/Textus/issues/90)
- **原生 ARM64 安装包**，支持 Windows（骁龙笔记本）和 Linux。
- **在设置里把 Textus 设为默认的 Markdown 编辑器。**[#183](https://github.com/CatVinci-Studio/Textus/issues/183)
- **文档里支持更多 HTML。** 可折叠的 `<details>`、HTML 表格、几种内联样式（颜色、字号、对齐），以及直接写在文档里的 `<svg>` 图形，写的时候、分屏预览和导出时都能正常显示。脚本一律不会运行。
- **测试版通道。** 在 **设置 › 通用 › 关于 Textus** 里选 **测试版**，就能比大家早一步收到候选版本；默认仍是 **正式版**。
- **自动保存**（需要手动打开）：边写边保存回原文件。[#133](https://github.com/CatVinci-Studio/Textus/issues/133)
- **在 App 里使用主题分享平台**：在设置里浏览、安装、更新主题。[#89](https://github.com/CatVinci-Studio/Textus/issues/89)
- **显示 Obsidian 的图片嵌入**（`![[image.png]]`），保存时原样写回。[#135](https://github.com/CatVinci-Studio/Textus/issues/135)
- **可以关掉自动补全结尾的 `*`**，自己输入。[#136](https://github.com/CatVinci-Studio/Textus/issues/136)
- **自己选图片存放的文件夹，或上传到图床。** 粘贴的图片可以放进子文件夹（默认 `assets`，名字可改）或文档所在的文件夹，也可以通过 PicGo、SM.MS 或 Imgur 上传。[#147](https://github.com/CatVinci-Studio/Textus/issues/147)

新功能放在这样的中版本里发布；补丁版本（1.1.x）只修问题。

## 最近完成

- **Textus 1.0.4**：侧边栏可以拖动调整宽度（[#77](https://github.com/CatVinci-Studio/Textus/issues/77)）；导出的 PDF 是白底、页边距正常，还可以带页码（[#68](https://github.com/CatVinci-Studio/Textus/issues/68)）；Windows 上把文件拖进窗口就能打开（[#78](https://github.com/CatVinci-Studio/Textus/issues/78)）；Linux 源码模式的字更清晰（[#61](https://github.com/CatVinci-Studio/Textus/issues/61)）；安装包更小。
- **Playground 已上线**：[textus.catvinci.com/playground](https://textus.catvinci.com/playground/)，不用安装就能在浏览器里试试编辑器。[#88](https://github.com/CatVinci-Studio/Textus/issues/88)
- **主题分享已开放**：在置顶的 issue 里发一条评论，我们看过之后，你的主题就会出现在 [textus.catvinci.com/themes](https://textus.catvinci.com/themes/) 上，大家都能免费下载。[#89](https://github.com/CatVinci-Studio/Textus/issues/89)

## 以后

- **随时速记。** 按全局快捷键弹出一个小小的 Markdown 窗口，写几句，关掉就保存好了。[#193](https://github.com/CatVinci-Studio/Textus/issues/193)
- **Textus AI 生成图片。** 写作时让它画插图、示意图，像其他提议一样确认后插进文档。[#194](https://github.com/CatVinci-Studio/Textus/issues/194)
- **语音输入**，可以直接输入到文档，也可以发给 Textus AI。[#195](https://github.com/CatVinci-Studio/Textus/issues/195)
- 能覆盖整个文件夹的目录，而不只是当前这一篇。
  [#79](https://github.com/CatVinci-Studio/Textus/issues/79)

## 想帮忙？

带 [`good first issue`](https://github.com/CatVinci-Studio/Textus/labels/good%20first%20issue) 标签的 issue 适合上手。如果你有这里没写到的想法，到[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)许个愿，或者给已有的愿望点个 👍。每一条我们都会看，呼声高的会放进这里。怎么构建 Textus、怎么提 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。
