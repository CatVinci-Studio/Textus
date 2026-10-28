import { loadSettings } from "../prefs/SettingsContext";
import { createPersistedList } from "../storage/persisted-list";

/**
 * Rolling history of text copied, cut or pasted in the editor: the 30 most
 * recent distinct entries, kept across restarts and windows. Only document
 * traffic is recorded, so settings inputs (API keys) never land in it.
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

/** Whether clipboard traffic on this target belongs to the document rather
 *  than an app input like the API-key field. */
function shouldCaptureFor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".milkdown, .source-view") !== null;
}

/** Copy/cut capture only applies to the source-mode textarea, where the DOM
 *  selection is the markdown. The WYSIWYG editor's DOM text drops math source,
 *  so it records serialized markdown from the editor state instead. */
function shouldCaptureTextOf(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".source-view") !== null;
}

/**
 * Installs the document-level capture listeners. Copy/cut snapshot the DOM
 * selection (a copy event's clipboardData can't be read back). Returns the
 * teardown.
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
