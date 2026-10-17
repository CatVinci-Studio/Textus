# Textus iOS 版规划

## 定位

iPhone 和 iPad 上的 Textus 是写作的随身伴侣：随手记、读、轻量修改，用 AI 审稿和改写。长篇写作和项目管理仍以电脑版为主。两端读写同一批 Markdown 文件，共享 `.textus/style.md` 和 `.textus/library/`。

先做 iPhone。iPad 保持现有界面可用，专门的适配放在 iPhone 之后（阶段 4）。

不做 Android；不做 Mac App Store 版（沙盒要求会去掉自动更新、终端命令、Pandoc 导出等功能，macOS 继续用 Developer ID 在官网和 Homebrew 发布）；不做自有云同步；不做账号体系。

## 技术路线

用 Tauri 2 的 iOS 支持，复用现有代码：

- **前端：** React 界面和 Milkdown 编辑器，移动端改布局、不改内核。
- **Rust：** `aicompat`（各服务商的请求格式、流式输出、Agent 循环）、`ai/`（提示词、工具、项目读取）原样复用。
- **桌面专属部分在 iOS 上不编译：** 窗口和多窗口、菜单、托盘、单实例、拖拽合并标签、自动更新、PDF 导出、终端命令安装、GTK 相关代码，全部用 `#[cfg(desktop)]` 隔开。

### 最大的技术风险：编辑器在 iOS WebView 里的输入

编辑体验必须和电脑版一致：同一个所见即所得编辑器（Milkdown/ProseMirror），不退回源码模式，也不换成另一套编辑器。WKWebView 里中文、日文输入法的组字、选区手柄、自动纠错和听写比桌面更容易出问题，所以阶段 1 专门把它们逐个修到可用：

- 输入法：沿用现有的组字保护（`isImeKeyEvent`、`view.composing` 检查），在真机上补全 WKWebView 特有的 `beforeinput` 和组字顺序差异；
- 选区：系统的选区手柄和放大镜要和 ProseMirror 的选区同步，长按菜单接入"问 AI"；
- 必要时在原生层补：关闭 WKWebView 的自动纠错和智能标点（`autocorrect`、`smartQuotes`），处理键盘弹出时的滚动和 `visualViewport`。

## 与电脑版的差异设计

| 方面      | 电脑版                           | iOS 版                                                                                                                                          |
| --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件      | 任意路径、项目文件夹             | 通过系统文件选择器授权（UIDocumentPicker），支持"文件"应用、iCloud Drive 和第三方存储；授权的文件夹即项目，用 security-scoped bookmark 记住授权 |
| 界面      | 多窗口、多标签、侧栏             | 一次一个文档；文档列表做首页；iPad 可以左右分栏                                                                                                 |
| 格式      | 快捷键、右键菜单                 | 键盘上方的格式工具条：标题、列表、加粗、链接、撤销                                                                                              |
| 续写      | 灰色文字，Tab 采纳               | 工具条上的"续写"按钮，候选以卡片显示，点一下采纳                                                                                                |
| 语法检查  | 下划线加悬停弹窗                 | 下划线，点击后从底部弹出建议                                                                                                                    |
| Textus AI | 右侧面板                         | 从底部拉起的抽屉；快速提问合并进来，选中文字后点"问 AI"                                                                                         |
| 修改审阅  | 文档内红绿标记加卡片             | 逐条全屏审阅：原文和改后上下对照，可以逐句选择，采纳或拒绝                                                                                      |
| 登录      | ChatGPT、Claude 账号，或 API Key | 第一版只支持 API Key 和自定义接口（含 Ollama），密钥存进 iOS 钥匙串；账号登录待确认两家是否允许移动端接入                                       |
| 更新      | 应用内自动更新                   | 由 App Store 负责，去掉更新器                                                                                                                   |

## 文件访问方案

iOS 应用不能直接读写任意路径：用户在"文件"应用里选的文件，是一个限时授权的地址（security-scoped URL）。读写前要先申请访问，读写时要用文件协调器（NSFileCoordinator，避免和 iCloud 同步冲突），用完释放；要在下次启动时继续访问，得把授权存成 bookmark。现在 Textus 的文件读写都在 Rust 里用 `std::fs` 完成，这在 iOS 上对用户选的文件不起作用，所以文件访问分两层：

1. **Textus 自己的文稿目录。** 在 Info.plist 打开 `UIFileSharingEnabled` 和 `LSSupportsOpeningDocumentsInPlace`，应用的 Documents 目录会出现在"文件"应用的"我的 iPhone › Textus"下。这里的文件 Rust 可以直接用 `std::fs` 读写，现有代码不用改。新建的文档默认存在这里。
2. **用户选择的文件和文件夹（含 iCloud Drive 和第三方网盘）。** 写一个小的 Swift 原生插件（`src-tauri/plugins/textus-files`，用 Tauri 的移动端插件机制），提供：
   - `pickDocument` / `pickFolder`：弹出 UIDocumentPickerViewController，文件夹即项目；
   - `read` / `write` / `list`：申请访问 → 文件协调器读写 → 释放；
   - `remember` / `restore`：把授权存成 bookmark（放在 Application Support），启动时恢复"最近的文件"和项目文件夹；授权失效时提示重新选择。

   前端在 iOS 上走这套接口，电脑上仍然走现有的 Rust 命令。分界放在 `platform/ipc.ts` 的文件读写函数里，调用方不需要知道平台。

3. **项目文件夹里的 `.textus/`。** 用户授权一个文件夹后，`style.md` 和 `library/` 通过同一个插件读取，AI 部分读到的内容和电脑版一致。iCloud Drive 上同一个文件夹在电脑和手机间同步，就是两端共享文风和资料库的方式。

4. **外部打开。** 在"文件"应用里点 `.md` 文件用 Textus 打开（声明 `CFBundleDocumentTypes`，支持就地打开），也走第 2 层的授权流程。

## 分阶段计划

### 阶段 0：工程打底（已完成，见 `docs/ios/code-map.zh.md`）

- `Cargo.toml` 把桌面专属插件（single-instance、updater、process 等）移到只在桌面平台编译的依赖里。
- `lib.rs`、`menu.rs`、`commands/` 里的桌面功能加上 `#[cfg(desktop)]`；iOS 上注册的命令只保留文件读写、AI、设置、草稿。
- 新增 `src/platform` 判断，前端在 iOS 上隐藏桌面专属入口：窗口按钮、菜单、终端命令、导出 PDF、自动更新。
- 新增 CI 任务：在 macOS 运行器上执行 `tauri ios build --ci`，不签名，只验证能编译。

### 阶段 1：编辑器验证（需要 Mac 和 iPhone 或模拟器）

- 在 iOS 模拟器和真机上测试：
  - 中文拼音和日文输入、听写；
  - 长文档滚动；
  - 选区和复制粘贴；
  - 表格、公式、代码块的显示。
- 发现的问题逐个修复，直到和电脑版的编辑体验一致；这一阶段完成前不进入阶段 2。

### 阶段 2：iOS 版 MVP

- 文档首页（最近文件、授权的文件夹），打开、新建、保存。
- 移动端布局：顶栏、键盘上方的格式工具条、Textus AI 抽屉。
- AI：选中改写、整篇审稿（批注）、逐条审阅修改、续写按钮。
- 设置：服务商、API Key（存钥匙串）、模型、语言、主题。
- 隐私：`PrivacyInfo.xcprivacy` 隐私清单；网络请求只发往用户选择的服务商。

### 阶段 3：上架

- Apple 开发者账号、App ID（`com.catvinci.textus`）、证书和描述文件。
- App Store Connect：应用信息、截图（6.9 寸和 6.5 寸 iPhone，13 寸 iPad）、隐私问卷（不收集数据）、分级。
- TestFlight 内测，然后提交审核。
- 发布流程：打 `ios-v*` 标签时，由 GitHub Actions 的 macOS 运行器签名并上传 TestFlight，所需证书和 API Key 存进仓库 Secrets。

### 阶段 4：iPad 增强

- 左右分栏（文档列表加编辑器，或编辑器加 Textus AI）、外接键盘快捷键、分屏视图。

## 需要你提供的

1. **一台装了 Xcode 的 Mac**：已有。本机构建、模拟器和真机调试在 Mac 上做。
2. **Apple 开发者账号**：已有（macOS 版正在使用），需要额外准备：
   - App Store Connect API Key（Issuer ID、Key ID、`.p8` 文件），用于 CI 自动上传；
   - 分发证书和描述文件，或者让 CI 用 API Key 自动管理签名。
3. **App Store 素材**：应用名、副标题、描述、关键词、隐私政策网址（可以放在官网上）、客服网址。
4. **一台 iPhone**：用于真机测试输入法。模拟器里的输入法和真机行为不完全一样。

## 不能由开发流程代替的部分

- 在 Linux 上无法构建、签名或运行 iOS 应用，也无法验证 WKWebView 里的实际输入体验。阶段 1 之后的每一步都需要在 Mac 或 CI 上完成并真机确认。
- 是否通过 App Store 审核由苹果决定。常见的风险点：只是网页套壳（需要原生体验的部分要做足）、AI 生成内容的说明、隐私问卷要和实际行为一致。
