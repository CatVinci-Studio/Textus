# Textus 会话首页、DeepSeek Harness 与行内听写改造草案

状态：供用户审阅；尚未修改产品实现。

## 目标

以用户提供的两张截图为交互参考：普通启动先显示会话首页，点击
`Write` 才进入文档编辑。Agent 直接使用 DeepSeek Harness 上游运行时。
语音成为输入框内的小型输入方式，支持增量文字和静音自动结束。

这份方案替代上一版“编辑器为首页、三栏工作台、独立录音审阅面板”的设计。
已有文档、草稿和资源不能因迁移丢失。

## 已核对的上游

- 源码：https://github.com/deepseek-ai/deepseek-harness
- 研究版本：`0.2.1-rc.2`，提交
  `687f282e8625c6b8d11ff58211a90524be2e4317`。
- SDK：`@deepseek-ai/dsh-sdk-client`；官方 `sdk` profile 支持本地运行时
  子进程和 stdio JSON-RPC，提供会话、提示词、事件订阅及关闭流程。
- 会话事件与实时 Agent 状态由 Harness 管理；模型适配器、工具、执行循环
  均属于上游插件系统。上游代码按其 MIT 许可证保留署名与许可。
- 上游也有语音输入插件，但当前说明仍是停止录音后转写，不能直接满足
  本次边说边显示的要求。

## 界面

普通启动默认选中 `Agent`。顶部为 `Agent | Write` 切换；左右位置和命名
保持稳定。侧栏显示新会话、会话搜索、项目/文档、历史会话与设置。主区域
起初仅显示居中标题和一个宽输入框，不默认展示三栏草稿工作台或空编辑器。

输入框底部放附件、模型/服务选择、小麦克风和发送按钮。采用应用现有的
主题变量和图标体系；参考截图的布局与留白，不复制其他产品品牌素材。
发送后进入会话内容与执行步骤，输入框固定在会话底部。

文档输出以可打开的文档卡片呈现。点击卡片的 `Write` 或顶部 `Write`，
进入当前文档的 Milkdown 写作视图。再回到 Agent，继续同一会话。
切换视图不卸载文档编辑器、不重建运行中的 Harness 会话，不清空 Undo。
已有的草稿审阅、修订冲突检测、批量采纳与图片资源提交继续复用。

## Agent 直接集成

采用官方 Harness SDK/运行时集成，而非重写它的 Agent loop，也不把整个
上游 Web 页面作为 iframe 塞进 Textus。

Tauri 管理本地运行时的启动、握手、事件转发、取消和退出。测试阶段固定
上游版本；桌面交付携带匹配的运行时，避免要求用户自己装 CLI 或 Node。
接入层只负责 Textus 与上游的协议转换和文档工具插件。

- 新 Agent 会话全部经过 Harness；退出当前自写的 Agent 执行入口。
- 使用上游的会话、执行循环、工具调度、流式事件和取消机制。
- 模型与凭据通过上游适配器配置；继续支持当前 MiniMax 文字服务。
- Textus 特有的读取当前文档、提案和生图通过插件连接现有事务/资源管线。
  模型提出的更改仍需由现有提交入口执行，避免绕过正在编辑的内存文档。
- 不把旧聊天历史删除或伪装成新运行时的内部事件；旧记录保留查看，
  新会话保存 Harness session 标识。
- 凭据留在 Host，不能出现在前端消息、模型提示词或运行日志中。

## 行内听写

移除独立录音表单和“转写后再使用”的大面板。麦克风位于输入框底部，
非录音时为小型描边图标；录音时仅用绿色状态与轻量音量反馈。

点击麦克风即明确开始本次听写。识别文本直接填入该输入框的捕获位置，
不再要求点击“使用转写”。输入框中原有内容、用户并行输入和光标位置
必须受保护；部分识别只能修改本次听写占有的文本范围。
识别结果绝不自动提交给 Agent，也不自动点击发送。

已经说过话后，默认连续静音约 1.5 秒自动结束；开始后约 5 秒仍未检测到
语音则结束等待。短暂停顿不切断句子。再次点击麦克风手动结束，Esc 取消
本次听写；切换会话、输入目标或关闭窗口会释放设备并忽略迟到结果。
具体静音阈值保留为内部参数，验收时用真实设备调节。

### 实时识别能力边界与待确认选项

MiniMax 当前文档中的 `/v1/speech_to_text` 接收完整音频文件。
`stream=true` 控制结果 SSE，并非持续麦克风音频上传协议：
https://platform.minimax.cn/docs/api-reference/speech-to-text

方案 A（保留当前提供商）：MiniMax 短片段增量转写，录音期间陆续回填文字，
静音后提交最后一段。UI 必须如实标注增量转写，不能宣称逐字实时。
需要实测分片边界、文字去重、标点、延迟和请求数。

方案 B（实时体验优先）：macOS 优先接入系统支持部分识别结果的语音接口，
MiniMax 保留为用户可选方案。启动前检查设备、权限、语言和本机识别能力；
本机不支持时不得静默切换到其他远程服务。其他桌面平台保留明确的能力降级。
这会改变当前默认 STT 提供商，实施前由用户选择。

## 验收

1. 首次启动和新会话显示截图所示结构：侧栏、居中输入框、Agent/Write。
2. Write 往返保留同一文档、聊天、运行状态和 Undo。
3. 实际启动固定版本 Harness，通过其 session/event 完成文本、工具调用、
   取消与恢复；不能靠仅安装依赖或仍调用旧 Agent 入口通过测试。
4. 麦克风 UI 不出现大面板；输入过程中能看到增量文字，静音自动结束，
   原有文字不被覆盖，结果不自动发送。
5. 真机测量首段文字出现延迟、停止延迟、噪声环境与中英混合效果；
   区分真正部分识别与 MiniMax 分段转写。
6. 回归文档修订冲突、图片资源迁移、旧会话查看、无 Key/离线编辑和进程退出。

## 范围

本次不增加截图中的定时任务、站点托管或其他无关模块。现有朗读与生图
保留，但界面收纳为会话/文档相关操作。移动端原生实时听写单独验收。

## Confirmed follow-ups (2026-10-18)

Offer actual Codex and Claude Code runtimes alongside Harness, with a separate model control. Write must remain a quiet page: no read-aloud panel, image form, microphone toolbar or legacy creation launcher. Illustration creation primarily uses selected text → right-click → the selected Agent refines a prompt → configured image provider → insert below the selected paragraph, gated by the captured revision. This explicit user action authorizes insertion; stale targets must preserve the generated asset without changing unrelated text.
