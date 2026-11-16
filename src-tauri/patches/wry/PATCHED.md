# wry 0.57.0, patched

The published wry 0.57.0 (src/, build.rs, Cargo.toml without its examples)
with one change from tauri-apps/wry PR #1924, open at the time:

- `src/webview2/mod.rs`, `parent_subclass_proc`: on `WM_SETFOCUS` the move of
  the focus into the webview is posted and runs only if the window still has
  the focus, instead of running inside `WM_SETFOCUS`. Calling `MoveFocus`
  there could leave WebView2's IME broken for a window until a restart when
  two windows share one browser process (tauri-apps/wry#1908,
  tauri-apps/tauri#16391). `WM_ENTERSIZEMOVE` keeps the old call.

When a wry release includes the fix: delete this folder, the `[patch.crates-io]`
entry and the `exclude` in `src-tauri/Cargo.toml`, and update the lockfile.
