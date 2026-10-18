# Unified media and quiet writing implementation plan

User explicitly requests autonomous implementation without more questions. This plan supersedes the older removal of all Write speech controls: restore a compact whole-document reader and selection-only context action, with all configuration in Settings.

## Required outcomes

1. Selected text → current Agent engine (Harness, Codex, Claude Code) → bounded polished image prompt → configured image API → revision-checked insertion beneath the selected paragraph. Fix errors; do not substitute a different engine.
2. Agent automatic images are off by default. When enabled, each supported engine can enqueue authorized image jobs while producing its draft. No manual image form on Agent.
3. Write has elegant, compact whole-document speech playback. Right-click reading sends only the selection. Image and TTS operation controls belong in Write, while service/model/key/voice/rate configuration belongs in Settings.
4. Dictation is available in ordinary input fields and the writing editor, cancels on Escape/focus/target changes, preserves manual edits, and does not auto-send. Select the configured service in Settings, not in the main composer.
5. Unified real provider adapters: OpenAI/OpenAI-compatible gateways, MiniMax, ElevenLabs, Deepgram, Gemini, DashScope and Azure Speech where capabilities exist. Compatible presets include SiliconFlow, Groq, Together and Volcengine; unsupported capability/provider combinations must be rejected rather than relabeled as working.
6. Match existing Textus row controls, typography, spacing, borders and dark/light themes. Verify actual screenshots and native application resources.

## Shared interfaces

`MediaProviderConfig` retains provider/endpoint/model/voice/credentialSource and adds optional `language` and `playbackRate`. Provider IDs: system (STT local only), openai, openai-compatible, minimax, elevenlabs, deepgram, gemini, dashscope, azure-speech, siliconflow, groq, together, volcengine. Do not expose keys to frontend. `textus-media-settings-change` announces saved configuration to active controls.

## Independent work domains (parallel skill)

- Provider backend: own `src-tauri/src/media/**` and necessary provider tests, native HTTP contract adapters, capability validation and response bounds. Do not edit frontend or engine bridge.
- Settings: own `src/settings/sections/media*`, new `src/media/provider-catalog*`, media-only CSS, and media section integration in existing settings. Use shared config interface; no main-screen forms.
- Write speech: own new compact Write controls, `useReadAloudTarget`, `EditorContextMenu`, `MilkdownEditor` integration and related tests/styles. Reuse playback queue and revision guards; avoid settings/provider configuration fields in operation UI.
- Root: own IPC schema/config notifications, shared configured dictation and all-input integration, Agent image engine bridge, selection image fixes, integration, verification, packaging and delivery.

Each domain must add meaningful regressions before fixes, report commands and limitations, and avoid editing other owners' files. Root reviews integration and runs complete checks. No external publishing or unrelated worktree cleanup.

## Verification

Frontend typecheck/lint/format/unit suite, Rust workspace tests and strict Clippy, Node official-runtime/CLI fixture tests, Playwright selection-image/selection-reader/full-reader/dictation/settings/dark/narrow flows, packaged runtime startup and actual native screenshot. Real provider calls are asserted only where credentials exist; deterministic HTTP contracts cover others and their missing-credential state remains visible.
