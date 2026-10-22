import { loadSettings } from "../settings/SettingsContext";
import { createPersistedList } from "../storage/persisted-list";

/**
 * Rolling history of text that moved through the clipboard inside the
 * editor - both directions (copies/cuts made here and pastes arriving
 * here). Capped at the most recent 30 distinct entries; re-encountering a
 * known text just bumps it to the top. Kept by Rust in
 * clipboard-history.json so the history survives restarts, and shared
 * across windows (see persisted-list.ts).
 *
 * Only clipboard traffic through the DOCUMENT is recorded - see
 * shouldCaptureFor: settings inputs (e.g. API keys) must never end up in a
 * plaintext history.
 */

export interface ClipboardEntry {
  text: string;
  at: number;
}

/** Where the browser fallback (no Rust) keeps the list. */
const CLIPBOARD_HISTORY_KEY = "textus-clipboard-history";
const MAX_ENTRIES = 30;
const MAX_TEXT_LENGTH = 50_000;

const history = createPersistedList<ClipboardEntry>(CLIPBOARD_HISTORY_KEY, {
  kind: "clipboard",
  max: MAX_ENTRIES,
  keyOf: (entry) => entry.text,
  isEntry: (e): e is ClipboardEntry =>
    typeof (e as ClipboardEntry)?.text === "string" &&
    typeof (e as ClipboardEntry)?.at === "number",
});

export function recordClipboardEntry(text: string): void {
  if (!loadSettings().enableClipboardHistory) return;
  const trimmed = text.trim();
  if (!trimmed || text.length > MAX_TEXT_LENGTH) return;
  history.upsert({ text, at: Date.now() });
}

export function clearClipboardHistory(): void {
  history.clear();
}

export function useClipboardHistory(): ClipboardEntry[] {
  return history.useEntries();
}

/** Whether clipboard traffic on this event target belongs to the document
 *  (the WYSIWYG editor or the source-mode textarea) rather than some app
 *  chrome input like the settings panel's API-key field. */
function shouldCaptureFor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".milkdown, .source-view") !== null;
}

/** Copy/cut capture only applies to the source-mode textarea, where the DOM
 *  selection IS the markdown source. In the WYSIWYG editor
 *  `getSelection().toString()` drops hidden math source and the synthesized
 *  delimiter widgets - clipboard-history-plugin.ts records the serialized
 *  markdown from the editor state there instead. */
function shouldCaptureTextOf(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".source-view") !== null;
}

/**
 * Installs the document-level capture listeners. Copy/cut snapshot the DOM
 * selection's text (the clipboardData of a copy event can't be read back);
 * paste reads the incoming text/plain. Returns the teardown.
 */
export function installClipboardCapture(): () => void {
  const onCopyOrCut = (e: ClipboardEvent) => {
    if (!shouldCaptureTextOf(e.target)) return;
    const text = document.getSelection()?.toString();
    if (text) recordClipboardEntry(text);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (!shouldCaptureFor(e.target)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (text) recordClipboardEntry(text);
  };
  document.addEventListener("copy", onCopyOrCut, true);
  document.addEventListener("cut", onCopyOrCut, true);
  document.addEventListener("paste", onPaste, true);
  return () => {
    document.removeEventListener("copy", onCopyOrCut, true);
    document.removeEventListener("cut", onCopyOrCut, true);
    document.removeEventListener("paste", onPaste, true);
  };
}
