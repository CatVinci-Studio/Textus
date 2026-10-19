# Agent Workspace and media

Desktop starts on **Agent**. Use the persistent **Agent / Write** switch to move between the conversation workspace and the document.
The editor remains mounted; switching views preserves its selection, Undo
history and conversation. **Create** proposes document content in a separate
draft. **Ask** and **Plan** remain read-only. Accept the whole draft or individual
changes to commit; one batch is one Undo step. Manual changes invalidate an old
draft's revision, including an edit followed by Undo. Resolve pending changes
before starting or restoring another task.

## MiniMax testing configuration

In **Settings → Textus AI → Media providers**, configure these independently:

| Capability       | Protocol                   | Base URL                    | Model             |
| ---------------- | -------------------------- | --------------------------- | ----------------- |
| Speech input     | MiniMax                    | `https://api.minimax.cn/v1` | `asr-1.0`         |
| Image generation | MiniMax                    | `https://api.minimax.cn/v1` | `image-01`        |
| Read aloud       | OpenAI / OpenAI-compatible | Your provider's base URL    | Your speech model |

To share the existing MiniMax text credential, select **Reuse the MiniMax text
API key**. Rust resolves the credential from the existing custom text endpoint
at request time. Only official MiniMax HTTPS hosts support this reference.
Alternatively save a separate media key. Secrets never return to the webview;
chat, speech and image models remain independent. A subscription text key may
have different media access from a pay-as-you-go key; the actual service response
determines availability.

The native adapters follow MiniMax's
[speech recognition](https://platform.minimax.cn/docs/api-reference/speech-to-text)
and [image generation](https://platform.minimax.cn/docs/api-reference/image-generation-t2i)
protocols. Speech uses multipart `/speech_to_text`, `stream=false`, JSON results,
and the language request header. Browser recordings are decoded and resampled
locally to 16 kHz mono PCM WAV before upload. Image generation uses
`/image_generation`, one result and a maximum 1500-character prompt. The
`image-01-live` model uses the closest selected aspect ratio instead of exact
pixel dimensions. MiniMax has no quality field in this adapter; quality options
belong to the compatible providers.

## Reviewed media

- **Dictate** uses the small composer microphone. System recognition inserts live partial text; the explicitly selected MiniMax alternative uploads after stop or silence. Transcripts enter the captured input range without sending the prompt. Limits are 120 seconds / 25 MiB. Focus changes, Escape and manual edits cancel range ownership.
- **Generate image** opens a manual proposal. To let the Agent enqueue images,
  explicitly enable image generation for that send. Each task permits two
  requests, including retries, with one network job at a time. Text generation
  continues while images run. Review cards show the exact anchor, prompt and
  available preview. Accepting writes a local document asset and inserts one
  Markdown image transaction. Stale anchors/revisions or a concurrent Save As
  cause rollback. Same-anchor images preserve request order. Undo removes the
  reference without deleting an accepted asset.
- **Write** is a quiet document surface. Read-aloud controls, microphone panels, manual image forms and the old creation launcher are removed from Write. Speech synthesis remains an optional assistant-reply capability.
- **Selection illustrations** start from the editor right-click menu. The selected official Agent refines the passage into an image prompt, then Textus generates the image and inserts it beneath the final selected paragraph after revision checks. The explicit right-click action authorizes that insertion; stale document revisions retain the generated image for recovery.

All remote media requests can incur provider charges. Provider configuration is
optional: ordinary Markdown editing works without any AI credentials.

## Persistence and recovery

Workspace drafts follow **Privacy → Draft recovery**, reference existing chat
history, and use separate versioned snapshots. Closing a pending task asks to
keep the draft when recovery is enabled, or discard it when disabled. Restoring
an interrupted request never resends it automatically. Moving a tab first stops
and snapshots its task and preserves document identity. Resolve pending work or
enable draft recovery before moving a tab when recovery is disabled.

Generated previews and job metadata live in the app data `media-jobs/` directory.
Cancellation deletes that job's temporary image; accepted images use the existing
`assets/` lifecycle, including migration on first save. Interrupted image jobs
are marked failed and require explicit retry. Credentials and original recordings
are excluded from task snapshots and Markdown.

Cross-directory Save As copies referenced `assets/` images before writing the
destination document, preserves source images, handles filename collisions, and
updates image-job references. Stopping a request fences its generation id in
Rust, including a late enqueue that has not reached the frontend job cache. A
new explicit send uses a new generation id while retaining the task's quota.
Conflict recovery persists an explicit conflict flag and keeps the original
base snapshot across repeated restarts. Partial acceptance maps captured
selection targets through the accepted transaction; it never retargets them to
the current UI selection.

## Verification

`e2e/workspace.spec.ts` covers draft creation, view switching, single-step Undo,
revision conflicts and reload without a second model request.
`e2e/multimodal.spec.ts` uses synthetic Web Audio with the browser's real
MediaRecorder and WAV conversion. Transcription, image jobs and playback are
mocked at IPC/audio boundaries. These tests do not prove physical microphone
capture or remote service availability.

Rust `media::live_tests` contains explicitly ignored paid MiniMax smoke tests.
Set `TEXTUS_MINIMAX_LIVE=1`, `TEXTUS_MINIMAX_CONFIG_DIR` to the existing Textus
configuration directory, `TEXTUS_STT_TEST_WAV` to a synthetic WAV fixture, and
`TEXTUS_MEDIA_TEST_OUTPUT` to a local output directory. Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib media::live_tests -- --ignored --nocapture
```

The image test exercises the production adapter, public HTTPS download checks,
real image decoding and atomic local storage. The speech test exercises the
native multipart adapter against synthetic local speech. Normal tests never
send paid requests. Physical microphones and native window handoff still need
manual macOS/Windows/Linux acceptance before a release.

## Acceptance record — 2026-10-17

- Frontend: 937 tests in 119 files; key workspace/media Playwright flows: 7/7.
- Rust library: 320 passed; 13 explicitly ignored live/interactive tests.
- Real MiniMax smoke: 2/2 passed using the existing MiniMax text credential.
  `image-01` returned a validated 1024×1024 JPEG through the production adapter
  and atomic local file write. `asr-1.0` transcribed local synthetic speech as
  “This is a text-to-speech input test.” No microphone audio or document content
  was sent by these smoke tests.
- Production frontend build and local macOS debug `.app` bundle built. The
  local bundle disables updater artifact signing; it is a test build, not a
  signed/notarized release.
- Independent code review found five important lifecycle issues. Regression
  tests and fixes cover repeated conflict recovery, document replacement,
  cross-folder assets, captured selections, and late image enqueue cancellation.
- Regular/narrow workspace screenshots inspected. Physical microphone capture,
  native drag-to-merge and Windows/Linux audio remain manual release checks.
  New media controls currently provide Chinese and English, with English
  fallback for other interface languages.

## Conversation home and official engines (2026-10-18)

The desktop opens in Agent. The persistent Agent / Write switch changes surfaces without remounting Milkdown, losing an unsent prompt or resetting Undo. The composer selects DeepSeek Harness, Codex or Claude Code separately from its model. Harness uses the configured OpenAI-compatible text endpoint (including the shared MiniMax text key). Native CLI models use their own login and model name; an empty model field keeps the CLI default. Missing installation or expired login is shown as an error, with no automatic engine substitution.

See `harness/README.md` for provenance, packaging and runtime limits. Local smoke checks completed an official Harness tool loop, a real MiniMax Harness request and a real Codex request. Claude Code was found but its OAuth session is expired; its authenticated end-to-end request remains unverified until the user signs in again.

The small composer microphone inserts partial system transcripts directly at the captured input selection. macOS requires microphone and speech recognition permission, and an available on-device language. It stops after about 2.5 seconds of silence after speech, or 8 seconds without initial speech. Manual edits revoke the captured range; focus loss, surface/session changes and window destruction release capture. The speech service and language are selected in Settings. Remote services upload a locally converted PCM WAV after recording stops; system on-device dictation provides partial live recognition. Dictation never sends the prompt. Native microphone permission UI, real room acoustics and recognition quality require manual hardware checks.

Validation for this revision: frontend `npm run check` (943 unit tests), Rust workspace tests (362 passed, 13 ignored), strict Clippy, 7 Node runtime/build tests, and 9 focused browser flows passed. The independent review's dependency installation, target architecture, Escape, and Windows process-tree findings were addressed. Physical microphone capture, native Windows process cleanup, Intel execution and signed notarization still need platform/hardware verification. The local macOS app bundles the official SDK, matching Node and licenses.

The Harness tool-result adapter maps upstream `message.toolCallId` to Textus `call_id`. A real official-runtime tool-loop regression checks both non-empty identity and call/result equality, preventing the previously observed missing-field failure.

## Unified media controls (2026-10-18)

Media settings follow Textus SettingRow and Select controls, with three capability tabs: Listen, Read and Illustrations. They contain service, model, voice, playback speed, language, advanced endpoint and private credentials. See [provider matrix and protocol references](media-providers.md) for the supported routes and limits. Saved configuration changes stop active speech capture/playback before another request. MiniMax can reuse the existing official text credential without returning the key to the frontend.

Write shows a compact Read control. It reads the entire document by default; right-click Read selected text captures only that selection. Speech is chunked to at most 600 Unicode scalars, queued one request at a time, and highlighted against the captured document revision. Changes during synthesis prevent stale playback. No manual provider forms or assistant-message speech controls appear in Agent.

Right-click Generate image below selection captures the selected passage and original paragraph. The currently selected Agent engine refines its prompt (and condenses overlong results using the same engine) before the configured image service runs. The ready image is inserted beneath that original paragraph with the existing revision/asset transaction. Only the selected passage is sent for refinement. Agent has one automatic-image checkbox, off by default; official Harness tools and native Codex/Claude structured image requests use the same host-authorized image-job quota. Ask/Plan never authorize paid image generation.

A quiet microphone appears for eligible focused text inputs and the rich writing editor. Native partials replace the previous dictated span, preserving surrounding text. Manual edits, caret movement in the rich editor, focus/window loss and Escape revoke capture. Password fields and duplicate composer microphones are excluded. Empty/silent recognition preserves the selected text and returns the microphone to idle. Remote recognition stops after silence and submits PCM WAV; it does not advertise streaming recognition. Azure capture is capped at 60 seconds. Dictation does not send a chat message or save the document.

### Unified media acceptance

- Frontend full check: 975 tests in 130 files, TypeScript, ESLint, formatting and repository consistency checks passed. The final Write-only context-menu guard also passed TypeScript, scoped ESLint and the browser flows.
- Rust workspace: 373 passed, 13 opt-in/interactive tests ignored; strict all-target Clippy passed with `tauri/custom-protocol`.
- Node: 9 Harness/native CLI tests and 2 packaging tests passed. The bundled Node and Host additionally completed the deterministic official Harness tool-loop fixture; bundled bridge sources match the worktree.
- Browser: 11 flows passed, covering same-engine selected illustration insertion, dictation, Write reading, draft conflicts/recovery, Settings, light/dark and narrow layouts. Native macOS startup, Write control and Settings layout were inspected.
- Paid MiniMax image smoke passed through the production adapter, safe download and decoding as a 1024×1024 JPEG. Other new provider adapters have deterministic HTTP-contract coverage, not account-level live verification. Claude Code's existing OAuth login is expired; authenticated Claude calls remain unverified.
- Silent/empty dictation preserves selected text; remote empty timeout restores idle. Regional speech locales and automatic remote language detection are tested. Historical failed image jobs no longer block fresh selection requests. Harness rejects overlong image prompts before invoking the paid bridge.
- The local macOS debug app was built and restarted. Physical microphone acoustics, remote streaming recognition, Windows/Linux hardware behavior and release notarization are outside this local acceptance.

## Stability and polish pass (2026-10-18)

Found by driving the real macOS dev app against the configured MiniMax text, image and speech services:

- Media errors showed `[object Object]`: structured `{ code, message }` backend errors now read as their message.
- Generated images in an unsaved document never rendered and were skipped on first save: their percent-encoded app-data path (`Application%20Support`) was encoded a second time. Local image paths are decoded before the asset protocol and before migration.
- Selection illustrations insert by their captured paragraph against the live document, so typing elsewhere while the image generates no longer strands it; each illustration has its own image quota. A floating status chip follows refine → generate → insert, with Cancel and dismissible errors.
- A failed stream discards its partial proposal (Retry no longer duplicates it); the workspace stops capturing proposals once its exchange ends; a refused early send keeps the typed prompt; skipping one change keeps an existing conflict; the interrupted-task notice clears with its draft; entering source mode asks to resolve running Agent work first; each document remembers its Agent/Write surface (startup and new empty documents open in Agent, opened files in Write).
- Dictation is no longer cancelled by the focus loss of the first macOS permission prompt. The engine model field follows engine changes made elsewhere. Dev builds no longer offer to replace themselves with the public release.
- Efficiency: streamed draft updates are coalesced (~90 ms) and the preview is computed only while Agent is visible; the document card serializes on change rather than every render; the step timeline is built in one pass; image-job polling keeps the old array when nothing changed and only image/tool turns trigger a refresh; the dictation button measures once per frame on scroll.
- Read aloud merges short neighbouring blocks (still ≤ 600 characters per request, highlighted together) and fetches the next chunk while the current one plays: the OneRec test document went from 281 requests to 19.
- Agent UI: one stylesheet on design-system and motion tokens; Agent ⇄ Write cross-fade with a sliding segmented switch; status pill with a working pulse; the task list becomes a drawer below 1000 px (the default 800 px window previously hid New task and history); the draft panel slides in from the right, can be tucked into a pill, and keeps Accept all / Reject all sticky; suggestion chips on the empty home; reduced motion falls back to fades.

Verified live: Agent edit → draft → Accept all → single-step Undo; selection illustration with typing during generation (inserted beneath the selected paragraph, 1024 px, rendered); MiniMax speech synthesis; read-aloud chunking. Playwright flows were not re-run here because the Chromium test browser is not installed on this machine (`npx playwright install chromium`).

## Images, dictation and composer pass (2026-10-18, second round)

- **Dictation in dev builds.** `tauri dev` runs a bare binary, so macOS held the launching app (terminal, editor) responsible for privacy prompts and aborted Textus on the first dictation (TCC: no `NSSpeechRecognitionUsageDescription`). Debug builds outside an `.app` now relaunch themselves as their own responsible process (`main.rs`, `dev_responsibility`), forwarding signals and exiting with their parent. Bundled builds are unaffected. Native recognition falls back to Apple's service when the on-device model for the language is missing, adds punctuation on macOS 13+, and waits 2.5 s of silence (8 s before any speech) instead of 1.5 s / 5 s; the same thresholds apply to remote recording. Common native errors read in Chinese and fade after 6 s.
- **Image tools.** A hovered or selected image shows a floating bar: preview, rotate left/right, width presets and, for generated images, the prompt. Rotation is stored beside the width in the title suffix (`{textus-width=50% textus-rotate=90}`); Pandoc export keeps the width and drops the rotation. Double-click (or the bar, or the context menu) opens a full-window viewer: wheel / pinch zoom around the pointer, drag to pan, double-click 1×/2×, quarter turns that persist to the document, Esc to close.
- **Generation prompts.** Right-click → Show generation prompt (or the viewer's prompt button) looks up the committed image job by the asset's file name (`media_image_prompt`), so it survives Save As migration, and offers a copy button.
- **Rendering placeholder.** While a picture is composed, queued, painted or inserted, a shimmering frame shaped like the requested size sits under its anchor paragraph — a widget decoration, so the document and its revision are untouched. Phase changes keep the shimmer continuous; the arriving image fades in.
- **Composer.** After the first message the turns fill the column and scroll while the composer rests at the bottom. The image permission is a toggle in the composer toolbar beside the mode picker; the header Stop only appears for images still running after the reply. Narrow composers drop secondary labels to keep one row where possible.
- **Selection visibility.** WebKit stops painting a contenteditable selection when focus moves to the context menu or another field; the editor now paints it itself while unfocused.

E2E: the Agent overlay now covers the whole editor area, so `openApp` switches to Write wherever the switch exists (including the iPad layout). Remaining Playwright failures also fail on commit 77b7ce5 (pre-existing).

## Navigation, images and assistance (2026-10-19)

- **Agent ⇄ Write** is one mode for the whole window, switched from the window bar with a matching pair of pills: "← Agent" leads the bar in Write, "Write →" ends it in Agent. Switching tabs or opening a file keeps the mode. The Agent surface starts below the tab bar, so tabs stay reachable; the chat-panel toggle is hidden in Agent. Read aloud is an icon beside it, the same size, with a counter and stop while reading. The document's microphone docks in the window's bottom-right corner.
- **Agent home suggestions** (Settings › Textus AI, on by default): short chips that fill the composer with a concrete, ready-to-send request; with a text model the set is written for the current document (built-in agent loop, Ask mode, cached per document state).
- **Name new documents automatically** (Settings, on by default): an untitled document without a heading takes a title suggested from its first accepted draft for its tab and the Save dialog's file name; the text is not edited (an inserted heading would have been a second Undo step).
- **Image jobs** are cards that lead with the prompt, with status, model and size, the insertion point, and Insert / Adjust prompt / Skip. **Adjust prompt** opens a small conversation: describe what is off, the text model rewrites the prompt (or edit it), then regenerate - anchored like a right-click illustration with its own quota. Generated images keep their prompt lookup across Save As renames (`image-…-N.jpg`).
- **Efficiency:** KaTeX (the largest library) loads on the first formula instead of at startup (entry bundle 2.05 MB → 1.79 MB); editor images load lazily and decode asynchronously; placeholder and toolbar effects use gradients instead of blur filters and no backdrop filters. A packaged Textus still runs WebKit's web, GPU and network processes; whole-app memory far below ~100 MB is not reachable with a webview architecture.
- **Dev only:** `window.__TEXTUS_TEST_SAVE_PATH__` (import.meta.env.DEV) lets an end-to-end run choose the Save As destination instead of the native panel.

Verified: `npm run check` (982 unit tests), Rust media tests and Clippy, and the full Playwright suite (233 passed; the 32 previously failing specs fixed - stale selectors after the Agent workspace, Linux-only shortcuts on macOS, and four product bugs: composer focus stealing from Settings, focus left in Agent after switching to Write, Write padding scrolling empty documents and Magic Diary, and the Agent surface covering the tab bar). End to end in the real app with MiniMax: a 《西游记》 summary drafted by the Agent, accepted, two illustrations generated and inserted, saved by Save As to `~/Documents/西游记内容概要.md` with its `assets/`.
