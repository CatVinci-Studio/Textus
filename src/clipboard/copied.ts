import { createSubscribers } from "../utils/store";
/**
 * Text the user copied or cut from a document, as it went on the clipboard
 * (Markdown, math source kept). Told to whoever listens: the plugins with the
 * clipboard permission (a clipboard history is one). Settings fields, API
 * keys among them, never get here.
 */
interface Copied {
  text: string;
  cut: boolean;
}

const copies = createSubscribers<[copied: Copied]>();

export function tellCopied(text: string, cut = false): void {
  const trimmed = text.trimEnd();
  if (!trimmed.trim()) return;
  copies.publish({ text: trimmed, cut });
}

export const onCopied = copies.subscribe;
