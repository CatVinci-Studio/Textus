# Agent home, Harness and inline dictation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** Default to a conversation home, switch explicitly into Write, run Agent turns using the official DeepSeek Harness runtime, and offer compact incremental dictation with silence stop.

**Architecture:** Keep the mounted Milkdown document and its reviewed transaction pipeline. A packaged Node sidecar uses the pinned upstream Harness SDK and document-tool plugins; Rust bridges its events and credentials. macOS native Speech supplies partial dictation results, with MiniMax as an explicitly selected alternative.

**Tech Stack:** React, Milkdown, Tauri/Rust, official DeepSeek Harness 0.2.1-rc.2, macOS Speech/AVFoundation.

**Spec:** docs/superpowers/specs/2026-10-17-agent-home-harness-dictation-design.md

## Global constraints

- Reuse official Harness SDK/runtime, not a new Agent loop; pin versions and preserve MIT notices.
- Never replace the live document without revision-checked review; Ask/Plan remain read-only.
- Default Agent home; Agent/Write switching must not unmount the document or interrupt an active turn.
- Dictation enters the captured input range, never sends the prompt; approximately 1.5 s speech-end silence and 5 s initial silence stop capture.
- Keep credentials in Host, guard late events and dispose process/device resources.
- User approved implementation; execute inline in the existing attached worktree.

## Review focus

- Sidecar termination must reap the official runtime as well as its parent.
- Streaming tool events must not bypass Ask/Plan or apply the same proposal twice.
- Input edits and focus changes must not redirect late partial transcripts into another input.
- A machine without local speech support must show a recoverable capability error, not silently send audio elsewhere.
- Switching documents, opening existing files, and history restoration must preserve document/task identities.

### Task 1: Official runtime and document tools

- [x] Add protocol tests for upstream session events, tool proposal forwarding, errors and cancellation; observe failure.
- [x] Add isolated pinned SDK/runtime dependencies, source/license provenance and packaging preparation.
- [x] Implement a thin sidecar and Rust bridge using the existing credential/provider resolution. Replace the production Agent IPC route; replay the privacy-controlled frontend history in a fresh owned runtime (ledgered ruling).
- [x] Register document read/proposal/image tools through Harness plugins. Verify actual upstream handshake and a real minimal turn with the configured text provider.
- [x] Test read-only modes, malformed events and child cleanup; commit.

### Task 2: Conversation-first shell

- [x] Add failing tests for default home, Write switching, composer and document continuity.
- [x] Replace the old three-column workspace with a centered conversation home and task/history sidebar; move draft review into document cards.
- [x] Add stable Agent/Write navigation, keep the editor mounted, and preserve all existing save/open/Undo paths.
- [x] Verify desktop/narrow/dark screenshots and old document editing flows; commit.

### Task 3: Compact dictation

- [x] Add failing tests for partial replacement, manual edits, silence stop, initial silence and cancellation.
- [x] Implement macOS native partial Speech recognition with capability/authorization checks and explicit microphone/speech usage descriptions.
- [x] Replace the separate review panel with a small microphone control bound to the actual text input; retain MiniMax as a selectable service with honest capability labels.
- [x] Keep current input text and cursor safe, release devices, and never auto-send. Verify native permission/error paths and automated fake input events; commit.

### Task 4: Integration and delivery

- [x] Run frontend check/build, Rust tests, runtime tests and key Playwright flows; inspect screenshots.
- [x] Package the matching runtime and Node for the local test application. Exercise actual Harness startup and termination.
- [x] Perform one independent final review, fix important issues with regressions, document remaining platform/hardware checks, rebuild and launch the test app.
