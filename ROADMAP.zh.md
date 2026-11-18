# 路线图

[English](ROADMAP.md) · Textus 接下来要做的事。已经发布的内容见[更新说明](docs/releases/)。

Textus 目前只有很少几个人在做，非常欢迎大家一起参与：提交 PR 可以小到改一个错别字，也可以大到做一个完整的功能；很多大家想要的功能更适合做成插件，任何人都可以写。

## 1.4.5：修复

- **全选恢复高亮**：文档第一行是标题时，Mac 上全选能选中但不显示蓝色。
- **正文字体列表**：装了的字体都列出来，中文、日文、韩文界面下也有英文字体；中文字体同时显示中文名（微软雅黑 Microsoft YaHei）。
- **图片旁边的光标**和图片一样高。
- **看大图**：触控板两指滑动是移动、捏合是缩放，缩放时也不会再把图推出窗口。
- **Mac 导出 PDF** 字号恢复正常（之前比 Windows 大约三分之一）。
- **网络代理**：默认跟随系统代理，并挪到「通用」，关掉 Textus AI 时也能设置，需要代理的网络里也能装插件。

## 1.4.6

- **通过 SSH 打开远端文件夹**，和 VS Code 一样：打开服务器上的文件夹，像本地文件夹一样写作；用你的 `~/.ssh/config` 和密钥，服务器上不用装任何东西。
- **批注跟着文件走**：批注和修订记录存进文件夹的 `.textus/`，随文件夹一起同步、进 Git，可以和别人共享；在 Textus 外面移动文件也不会丢。已有的批注在打开文档时自动搬过去。
- **PDF 打印选项**：纸张大小、页边距、字号、页码。
- **插件能做更多**：自己的数据库视图、来自别处的文件夹（上面的 SSH 文件夹就用它）、其他应用的文件夹结构（比如 Logseq）、以文件夹形式保存的文档（比如 TextBundle），以及边写边出的 AI 回答。
- **Mermaid 图表可以折叠**，和标题一样收成一行。
- **安卓**：用"文件"App 打开的文件夹，也能整个文件夹搜索、使用数据库。

## 想帮忙？

这些现在就开着，等人来做：

- **通读一种语言的界面翻译**，改掉读着别扭的地方：[日语](https://github.com/CatVinci-Studio/Textus/issues/672)、[韩语](https://github.com/CatVinci-Studio/Textus/issues/673)、[法语](https://github.com/CatVinci-Studio/Textus/issues/674)、[德语](https://github.com/CatVinci-Studio/Textus/issues/675)、[西班牙语](https://github.com/CatVinci-Studio/Textus/issues/676)、[葡萄牙语](https://github.com/CatVinci-Studio/Textus/issues/677)、[俄语](https://github.com/CatVinci-Studio/Textus/issues/678)。
- **适合第一次提交的小 PR**：[修好开发者文档里的三个坏链接](https://github.com/CatVinci-Studio/Textus/issues/670)、[为导入 Word 文档时的罗马数字列表补测试](https://github.com/CatVinci-Studio/Textus/issues/671)。
- **大家想要的插件**：[MkDocs / Zensical 提示块](https://github.com/CatVinci-Studio/Textus/issues/220)、[Cisco IOS 代码高亮](https://github.com/CatVinci-Studio/Textus/issues/639)。

或者挑一个别的还没人认领的 [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee)、[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) 或[插件点子](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22)，并阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。插件在 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) 里开发。自己的愿望可以写在[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)；给 issue 点 👍 能让它往前排。
