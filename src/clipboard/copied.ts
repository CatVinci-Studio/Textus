/**
 * Text the user copied or cut from a document, as it went on the clipboard
 * (Markdown, math source kept). Told to whoever listens: the plugins with the
 * clipboard permission (a clipboard history is one). Settings fields, API
 * keys among them, never get here.
 */
export interface Copied {
  text: string;
  cut: boolean;
}

const listeners = new Set<(copied: Copied) => void>();

export function tellCopied(text: string, cut = false): void {
  const trimmed = text.trimEnd();
  if (!trimmed.trim()) return;
  for (const listener of listeners) listener({ text: trimmed, cut });
}

export function onCopied(listener: (copied: Copied) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
