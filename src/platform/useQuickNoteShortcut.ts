import { useEffect, useState } from "react";
import {
  quickNote,
  QUICK_NOTE_SHORTCUT_STATUS,
  type QuickNoteShortcutStatus,
} from "./ipc";
import { isDesktopApp } from "./capabilities";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";

/**
 * The Quick Note shortcut as Rust registered it (or couldn't): asked once,
 * then kept current by the event Rust sends every window after each
 * change (src-tauri/src/commands/quick_note/shortcut.rs). Null until
 * known, and always on iOS, which has no such shortcut.
 */
export function useQuickNoteShortcut(): QuickNoteShortcutStatus | null {
  const [status, setStatus] = useState<QuickNoteShortcutStatus | null>(null);
  useEffect(() => {
    if (!isDesktopApp) return;
    let alive = true;
    void quickNote
      .shortcutStatus()
      .then((s) => {
        if (alive && s) setStatus((now) => now ?? s);
      })
      .catch(() => {});
    const unlisten = unlistenAll(
      listenToThisWindow<QuickNoteShortcutStatus>(
        QUICK_NOTE_SHORTCUT_STATUS,
        (event) => setStatus(event.payload),
      ),
    );
    return () => {
      alive = false;
      unlisten();
    };
  }, []);
  return status;
}
