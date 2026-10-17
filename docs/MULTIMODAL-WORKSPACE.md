# Agent Workspace and media

Use **Create with AI** above a document to open its conversation workspace.
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

- **Dictate** in the composer or editor asks for microphone access. Start does
  not upload. **Stop and transcribe** explicitly uploads; the result is editable
  before using it in the composer or inserting it into the document. Nothing
  sends to the Agent automatically. The limit is 120 seconds / 25 MiB. Reaching
  the time limit stops locally and waits for an explicit transcription action.
- **Generate image** opens a manual proposal. To let the Agent enqueue images,
  explicitly enable image generation for that send. Each task permits two
  requests, including retries, with one network job at a time. Text generation
  continues while images run. Review cards show the exact anchor, prompt and
  available preview. Accepting writes a local document asset and inserts one
  Markdown image transaction. Stale anchors/revisions or a concurrent Save As
  cause rollback. Same-anchor images preserve request order. Undo removes the
  reference without deleting an accepted asset.
- **Read aloud** supports the selection, document, cursor onward, and assistant
  replies. It queues natural paragraph chunks of at most 3000 Unicode characters.
  Pause, resume, speed, retry and stop operate on the current queue. Reading
  highlights use decorations and do not alter document content. Switching a
  document or leaving the active reading surface cancels playback and requests.

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
