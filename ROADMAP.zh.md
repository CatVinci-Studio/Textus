# 路线图

[English](ROADMAP.md) · Textus 接下来要做的事。已经发布的内容见[更新说明](docs/releases/)。

Textus 目前只有很少几个人在做，非常欢迎大家一起参与：提交 PR 可以小到改一个错别字，也可以大到做一个完整的功能；很多大家想要的功能更适合做成插件，任何人都可以写。

## 1.4.6

- **通过 SSH 打开远端文件夹**，和 VS Code 一样：打开服务器上的文件夹，像本地文件夹一样写作；用你的 `~/.ssh/config` 和密钥，服务器上不用装任何东西。
- **批注跟着文件走**：批注和修订记录存进文件夹的 `.textus/`，随文件夹一起同步、进 Git，可以和别人共享；在 Textus 外面移动文件也不会丢。已有的批注在打开文档时自动搬过去。
- **PDF 打印选项**：纸张大小、页边距、字号、页码。
- **插件能做更多**：自己的数据库视图、来自别处的文件夹（上面的 SSH 文件夹就用它）、其他应用的文件夹结构（比如 Logseq）、以文件夹形式保存的文档（比如 TextBundle），以及边写边出的 AI 回答。
- **标题的折叠箭头移到页边**，和拖动手柄放在一起，不再插在标题文字里，选中、输入、导出都不会碰到它。
- **延后加载统一规则**：长文档里的分块、公式、图表、插件小窗口、图片都是滚到附近才画；导出、打印、搜索、跳到标题，都按同一套规则把整篇加载完。
- **插件接口全面检查**，一次统一更新。
- **编辑更流畅**：全面检查打字、滚动、拖动时的卡顿，改进拖动块的手感，打磨界面细节。
- **Tab 键统一**：列表和待办里按 Tab 缩进一级，Shift+Tab 退回；公式块和文档开头的属性区里像代码块一样缩进；源码模式里整行缩进列表。有续写建议时 Tab 仍先收下建议。
- **Windows 和 Linux 上全选**的颜色和平时选中一样。
- **Mermaid 图表可以折叠**，和标题一样收成一行。
- **安卓**：用"文件"App 打开的文件夹，也能整个文件夹搜索、使用数据库。
- **iPhone 和 iPad 上架 App Store**（先在 TestFlight 公测）。
- **iPhone 横屏**只在摄像头那一侧留空，另一侧在圆角处留一点边；手机标签栏的加号固定在一个位置。
- **Mac 上的问题列表**：点一条问题，它的说明卡片又能弹出来了。

## 想帮忙？

这些现在就开着，等人来做：

- **大家想要的插件**：[MkDocs / Zensical 支持](https://github.com/CatVinci-Studio/Textus/issues/220)、[Cisco IOS 代码高亮](https://github.com/CatVinci-Studio/Textus/issues/639)、[按 Foam 工作区的设置来](https://github.com/CatVinci-Studio/Textus/issues/724)。
- **手机**：[安卓的返回键先在应用里一步步退回，最后才离开](https://github.com/CatVinci-Studio/Textus/issues/725)。
- **适合第一次提交的小 PR**：[插件指南里补一个 `ai.stream` 的完整例子](https://github.com/CatVinci-Studio/Textus/issues/726)、[数据库视图的入门教程](https://github.com/CatVinci-Studio/Textus/issues/727)、[安装检查认出换了名字的接口调用](https://github.com/CatVinci-Studio/Textus/issues/728)。

或者挑一个别的还没人认领的 [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee)、[help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) 或[插件点子](https://github.com/CatVinci-Studio/textus-plugins/issues?q=is%3Aopen+label%3A%22plugin+idea%22)，并阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。插件在 [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins) 里开发。自己的愿望可以写在[许愿池](https://github.com/CatVinci-Studio/Textus/issues/196)；给 issue 点 👍 能让它往前排。
