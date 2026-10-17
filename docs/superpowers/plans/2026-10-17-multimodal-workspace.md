# Multimodal Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task.

**Goal:** 实现批准设计的 M0–M4。
**Architecture:** 常驻 Milkdown，共用 AgentConversation；草稿修订检查后通过单个事务提交；Rust 执行独立配置的媒体请求。
**Tech Stack:** React 19、TypeScript、Milkdown/ProseMirror、Tauri 2、Rust、Vitest、Playwright。
**Spec:** docs/superpowers/specs/2026-10-17-multimodal-workspace-design.md

## Global Constraints

- 不新增 Markdown 引擎或 Agent runtime；Ask/Plan 保持只读。
- 切换工作台不卸载编辑器；草稿必须明确采纳。
- STT/TTS 超时 120 秒，图片 180 秒；录音 120 秒/25 MiB。
- TTS 每块 3000 字符；图片每任务 2 张、并发 1、2048×2048、20 MiB。
- 凭据沿用 Rust 认证存储；真实硬件/供应商验证与 mock 验证分开记录。

## Review Focus

- Undo 回到相同文本后旧 revision 仍失效。
- 多个 append 保持顺序，重叠替换失败时整批不提交。
- 取消后的权限/网络迟到结果不能继续工作。
- 图片 URL 的重定向、DNS 重绑定、响应超限不得绕过校验。
- 恢复不重复付费请求；另存为不破坏图片引用。

### Task 1: Revision-aware draft core

**Files:** create `src/ai/workspace/revision-plugin.ts`, `document-draft.ts`, `document-draft.test.ts`; modify `src/document-view/editor-extensions.ts`.
**Interfaces:** `DocumentDraft` 绑定 documentId/sessionId/baseRevision/baseMarkdown/operations；`buildDraftTransaction(ctx, state, draft)` 返回已验证事务或失败；`documentRevisionKey` 逐次正文事务递增。

- [ ] 添加测试：有序 append、唯一/重复/缺失锚点、重叠操作、空文档、过期修订、单次 Undo、取消整批。
- [ ] `npx vitest run src/ai/workspace`，确认缺少实现失败。
- [ ] 复用 findMarkdownMatch、composeMarkdownEdit、applyEditRange，在临时 state 验证每步，最终仅 dispatch 一次。
- [ ] 同一命令应通过；类型检查通过；提交代码与测试。

### Task 2: Workspace and Create

**Files:** create `src/ai/workspace/AgentWorkspace.tsx`, `labels.ts`, `workspace.css`, `src/document-view/useDocumentWorkspace.ts`; modify `MilkdownEditor.tsx`, `useEditorProposals.ts`, ChatBody/ChatComposer、SettingsContext、ipc.ts、Rust agent.rs。
**Interfaces:** 工作台复用编辑器 conversation；发送前同步捕获 revision；Create 的 propose_edit 进入草稿而非正文 decoration。

- [ ] 测试 Create 工具权限、Ask/Plan 拒绝，以及视图往返、运行取消、草稿审阅和手改冲突。
- [ ] 先观察失败，再实现入口、时间线、章节预览、单项/批量采纳、拒绝、停止和编辑器切换。
- [ ] 相关 Vitest/Rust 测试、typecheck、lint 通过后提交。

### Task 3: Persistence and close lifecycle

**Files:** create `src/ai/workspace/draft-store.ts` 和测试；扩展现有 drafts IPC/Rust 存储、close-flow 和 dev shim。
**Interfaces:** 独立版本化草稿，引用聊天 session；恢复 running 为 interrupted，不重新发请求。

- [ ] 测试损坏/未知版本、并发写入、旧正文冲突、未处理任务关闭和另存为。
- [ ] 观察失败，再沿用 pending-writes/原子存储实现保存、恢复与关闭保护。
- [ ] 恢复/生命周期测试通过后提交。

### Task 4: Media configuration and adapters

**Files:** create `src-tauri/src/media/{mod,provider,image,speech}.rs` 与前端媒体配置组件；修改 ipc.ts、settings、Rust lib.rs/Cargo.toml。
**Interfaces:** STT/TTS/image 分别配置 provider/endpoint/model/credential ref；requestId 可取消；OpenAI-compatible adapter 明确限定能力。

- [ ] 测试未配置、认证、超时、取消、无效响应、有界读取、图片 MIME/像素和公网 HTTPS 校验。
- [ ] 观察失败，再实现 Rust 请求与薄 IPC；凭据不进入聊天/文档。
- [ ] Rust 单测/cargo check、设置迁移、前端检查通过后提交。

### Task 5: Reviewed speech input

**Files:** create `src/voice/useRecording.ts`, `VoiceInput.tsx` 及测试；集成 Composer 和 document-view。
**Interfaces:** 显式停止并转写后才上传；结果可编辑，明确插入/发送；编辑器选择区快照必须验证。

- [ ] 测试权限拒绝、设备缺失、取消后迟到结果、时长/体积上限、文档切换。
- [ ] 观察失败，再实现状态机、语言选项和音轨/URL/缓冲区清理。
- [ ] 测试无自动上传/发送/插入，验证通过后提交。

### Task 6: Asynchronous image jobs

**Files:** create 前后端 media image-job 模块；修改 tools.rs、agent.rs、现有 assets 接口和工作台。
**Interfaces:** generate_image 返回 jobId，不阻塞文字；Rust 验证任务授权/限额；顺序与锚点固定；接受时保存资源并事务插入。

- [ ] 测试默认拒绝、只读模式、配额、乱序、取消、重试、资源回滚及首存迁移。
- [ ] 观察失败，再实现工具、队列、预览卡片、插入/跳过和本地元数据。
- [ ] 验证重开/导出图片引用，测试通过后提交。

### Task 7: Speech playback

**Files:** create `src/voice/speech-chunks.ts`, `useSpeechPlayback.ts`, `SpeechPlayer.tsx` 和测试；集成 document-view/ChatMessages。
**Interfaces:** 选区/光标/全文/回复范围，3000 字符自然段分块，最多预取一块；装饰高亮不改正文。

- [ ] 测试中英混排、超长段、Unicode 边界、暂停继续、获取中停止、文档切换。
- [ ] 观察失败，再实现队列、音色/速度、取消和音频清理。
- [ ] 测试证明正文不变和无残留播放，通过后提交。

### Task 8: Integration verification

**Files:** create `e2e/workspace.spec.ts`, `e2e/multimodal.spec.ts`；扩展 dev shim 和架构/存储/使用文档。

- [ ] 测试四章初稿、审阅提交、切换、冲突、Undo、恢复、语音审阅和异步图片。
- [ ] 运行 typecheck、lint、test、check、build、Rust 检查和关键 Playwright；检查常规/窄窗口截图。
- [ ] 全量审阅并用回归测试修复实质问题；记录硬件和真实服务实测限制。
