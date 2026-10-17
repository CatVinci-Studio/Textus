# Textus 多模态 Agent 工作台技术设计

日期：2026-10-17。状态：待用户评审；实现方向已经确认，尚未开始产品代码修改。

## 目标和范围

依据用户提供的 `Textus_AI_Multimodal_Agent_PRD.md`，将现有 Markdown 编辑器扩展为对话驱动的文档创作工作台。用户已确认：复用现有 Agent、聊天历史和提案管线，工作台与编辑器共享文档，切换不卸载编辑器；按 M0–M4 推进，M5–M6 留待后续。

完成标准是用户能够从任务生成待采纳草稿，审阅后提交到同一个文档，进入现有编辑器修改并返回工作台；可选择录音转写、生成本地插图和朗读文本。没有媒体配置时，编辑和文本 Agent 继续可用。

本次不实现多人协作、自由文件系统写入、实时双向语音、移动端音频适配、图片重绘、多候选图片或 Agent/完整编辑器的新增分屏模式。现有编辑器内已实现的布局保持兼容。

## 已核对的代码基础

| 位置 | 现有能力与扩展点 |
| --- | --- |
| `src/app/MainPane.tsx` | 每个标签的编辑器保持挂载；工作台切换延续该约定。 |
| `src/document-view/EditorPane.tsx` | 保存草稿导致路径变化时不重新挂载，保留撤销、聊天和提案。 |
| `src/document-view/useEditorProposals.ts` | 拥有聊天、ProposalStream 和提案回调，是工作台的组合边界。 |
| `src/ai/chat/useAgentConversation.ts` | 复用发送、取消、重试、历史恢复和持久化。 |
| `src/ai/revision/usePendingEdits.ts` | 复用锚点解析和逐项审阅；现有 acceptAll 逐项提交，新批次提交需单独实现原子性。 |
| `src-tauri/src/ai/agent.rs`、`tools.rs` | 扩展现有运行循环；Ask/Plan 当前不提供编辑工具。 |
| `src/platform/ipc.ts` | 所有新增 IPC 契约集中定义，与 Rust serde 类型一致。 |
| `src-tauri/src/commands/fs.rs` | 沿用 save_pasted_image / migrate_draft_images 资源生命周期。 |

遵循 `docs/ARCHITECTURE.md` 的依赖层级。`editor/` 不导入 `ai/`；组合放在 `document-view/` 和 `app/`，工作台功能放在 `ai/workspace/`。不新建 Markdown 引擎和 Agent runtime。

## 方案选择

采用现有编辑器常驻、同一会话驱动多个视图的方案。相比工作台维护第二份可保存 Markdown，这能避免双向同步和撤销分叉；相比重写全局文档引擎，影响范围更小。

工作台使用任务/历史栏、聊天与时间线、只读草稿预览三部分。窄桌面窗口允许折叠历史和预览。已有文档提供工作台入口；新文档提供空白编辑与 AI 创作入口。顶部显示标题、保存状态、运行状态、停止和进入编辑器。草稿始终标注“待采纳”，不会因切换视图自动写入正文。

## 共享会话与修订

一个标签绑定一个 documentId，另有独立 sessionId 与 taskId。另存为只更新路径，不改变 documentId。文档会话保存视图模式、当前任务、提案批次和编辑器位置；聊天正文继续由现有聊天历史持久化。

revision 是单调递增的会话修订号，正文事务、撤销、重做、外部重新载入均使其增长。任务请求携带 baseRevision 和正文快照；提交前同步读取编辑器当前正文和 revision，不能依赖有延迟的标签 onChange。恢复后重新建立修订基线，旧提案只有快照与正文一致时才可提交。

MVP 对 revision 不一致采取保守冲突处理：保留预览、标明冲突、允许重新生成，不自动猜测插入位置。即使 revision 相等，仍检查锚点唯一性、目标文本和批次内部操作冲突。

视图切换仅改变可见布局，不销毁编辑器和会话。输入焦点恢复到切换前控件，编辑器选择区与滚动位置保留。文档切换中止录音、转写和朗读；文本/生图任务可在其所属会话继续运行并显示状态。

## Agent 模式、草稿和提交

Ask 与 Plan 保持只读工具集，后端执行入口也校验模式。Create 新增为创作模式：初期通过现有 propose_edit 的 append/insert/replace 操作产生章节草稿，不另建不兼容补丁协议。Edit 继续使用现有提案审阅。

任务状态为 idle、running、review、done、failed、cancelled。执行完成与提交完成是不同状态。时间线从现有工具和流事件派生步骤，包含计划、章节生成、图片生成、审阅和提交；停止后保留已生成的可审阅内容。

草稿批次包含 draftId、taskId、documentId、baseRevision、基础正文快照和有序操作。工作台右侧在基础正文上合成预览，不写磁盘。整篇创建可按章节预览和采纳；部分采纳后，剩余操作必须根据实际提交结果重新验证。

新增批次提交入口复用提案解析，先在临时事务中解析并验证所有目标，再一次 dispatch。任一冲突则整批不提交。单个批次构成一次 Undo，已有逐项审阅行为不变。拒绝或停止不撤回已经提交的内容。新任务不会无提示丢弃工作台尚未处理的草稿。

## 媒体配置与服务边界

聊天、STT、TTS、图片分别配置 providerId、endpoint、model 和 credential 引用。React 不持久化明文 Key；凭据沿用 Rust 认证存储。每个能力明确标示远程处理、请求范围和可能收费，无可靠价格时显示请求数。

首批实现明确命名的 OpenAI-compatible HTTP adapters，分别使用 multipart transcription、speech 与 image generation 协议；不宣称所有兼容聊天的服务也兼容媒体。每种能力独立报错和降级，adapter 边界允许后续增加供应商协议。

新增 IPC command 在 `src/platform/ipc.ts` 声明，Rust handler 保持薄层。所有任务带 requestId，支持主动取消和超时；错误结构区分未配置、认证、超限、网络、取消与无效响应。默认请求超时：STT/TTS 120 秒，图片 180 秒。

## 语音输入 M2

在明确点击麦克风后请求系统权限并录音；仅在用户点击“停止并转写”后上传录音。提供取消，且取消不会发送音频。录音开始前显示服务和外发提示；停止轨道后校验体积，再通过 IPC 交给 STT adapter。

状态为 idle → requesting_permission → recording → transcribing → review，任意阶段可取消或失败。单段最多 120 秒、25 MiB；达到时长上限停止录音并等待用户确认转写。支持中文、英文、自动语言；优先使用设备实际支持的音频 MIME，并携带正确文件名。

Agent 目标将结果填入可编辑 Composer，不自动发送。编辑器目标显示可编辑审阅框，明确点击插入后才以事务写入录音开始时捕获的选择区；正文或目标变化则提示重新定位。关闭面板、切换文档和卸载释放轨道、缓冲区和 object URL，迟到的权限/网络结果不得重新启动流程。

## 生图 M3

编辑器提供显式生成入口，Agent 增加 generate_image 工具。自动生图默认关闭；任务内开启后才提供该工具并允许执行，权限不能由模型参数自授。Ask/Plan 不执行生图。默认每任务最多 2 张、单次 1 张、并发 1；最多 2048×2048 像素、单张下载/解码输入最多 20 MiB，超限报错并保留正文草稿。

图片任务独立运行，Agent 工具返回 jobId 后文字循环可继续。jobId、任务序号和唯一锚点确定落点，完成顺序不改变文图顺序。图片提案展示 prompt、alt、图注、位置和 queued/running/ready/failed/cancelled 状态，支持取消、重试、插入、跳过。

Rust 对 base64 或临时 URL 结果执行大小、真实 MIME、像素检查，仅接受 PNG/JPEG/WebP。临时 URL 仅允许 HTTPS 公网目标，禁用自动重定向，过滤回环、私网、链路本地等目标，并将实际连接绑定到已验证 DNS 结果，防止重绑定。响应采用有界读取。可配置的服务 endpoint 与服务返回的下载 URL 使用不同策略，以保留用户自配本地服务能力。

生成结果保留为任务临时资源；用户接受后，经已有资源保存接口写入 assets，原子提交 Markdown 引用。写资源成功而正文提交失败则回滚本次新资源。未保存文档沿用 app-data assets 与首存迁移；最终正文不包含临时云端 URL。prompt、模型、时间和操作关联元数据本地单独保存，不写入正文。取消清理临时资源；已提交资源不因 Undo 立即删除。

## 语音输出 M4

提供选区、从光标、全文和 Agent 回复朗读。调用前展示文本范围和 Provider，按自然段切块，每块最多 3000 字符；超长段按句子/字符安全拆分，最多预取一块。提供播放、暂停、继续、停止、0.5–2 倍速度和服务支持的音色选择。

通过 Rust 获取有界音频片段后播放，段落级高亮仅为装饰，不修改正文。停止、切换文档、关闭窗口会取消请求、停止播放、清空预取和释放 object URL。失败后可重试当前段，不能令正文变脏或阻塞编辑。

## 持久化与关闭恢复

任务草稿使用独立版本化存储，包含 documentId/sessionId、基础正文快照、操作、步骤和媒体引用；不复制聊天正文、不改旧聊天 schema。复用 pending-writes 和原子写入机制。恢复时 running 任务变为 interrupted，不自动重发收费请求；保留已完成文本和有效临时媒体，失效资源提示重试。

窗口关闭、关闭文档和标签交接纳入未处理提案/任务检查，提供保留草稿、明确放弃或取消关闭。清理仅删除属于该任务且未被已提交文档引用的临时文件。旧 Markdown、旧聊天、现有草稿恢复和首存资源迁移保持兼容。

## 交付顺序与验收

| 阶段 | 交付 | 必须通过的验收 |
| --- | --- | --- |
| M0 | 共享会话、工作台入口、能力配置模型 | 切换保留正文、选择区、滚动、Undo、会话和运行状态。 |
| M1 | Create、章节预览、时间线、原子批次提交、恢复 | 四章草稿可预览采纳；中途手改触发冲突；一批一次 Undo；Ask/Plan 后端拒绝写入。 |
| M2 | 录音、STT、双目标审阅 | 权限拒绝/设备缺失/超限/取消可恢复；未确认不上传、不发送、不写正文。 |
| M3 | 图片 adapter、异步任务、授权和 assets 集成 | 文本不等图片；乱序返回落点正确；超限/SSRF/取消安全；首存、重开、导出引用有效。 |
| M4 | 分块 TTS、播放器、段落高亮 | 长文有界请求；暂停继续正常；停止和切文档无残留播放。 |

每批运行相关 Vitest 与 Rust 单测，关键流程加入基于 dev Tauri shim 的 Playwright 测试。最终运行 typecheck、lint、test、check、生产构建及 Rust 检查。设备麦克风、实际供应商和跨平台硬件验证需明确记录实测环境；无凭据时不得把 mock 测试描述为真实服务通过。

## 参考与采用范围

- [Claude Code 官方架构](https://code.claude.com/docs/en/how-claude-code-works)：参考上下文→工具执行→验证循环、可中断执行和会话持续性。
- [OpenCode Agents](https://opencode.ai/docs/agents/) 与 [Permissions](https://opencode.ai/docs/permissions/)：参考规划/执行模式分离和工具权限控制。
- Textus 的 `ARCHITECTURE.md`、`AI-PROPOSALS.md`、`AI-CONCEPTS.md`、`STORAGE.md` 是实际集成基础。

上述项目用于设计参考，不引入其运行时依赖；具体实现继续使用 Textus 的 React/Milkdown/Tauri/Rust 技术栈。
