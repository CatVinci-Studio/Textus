/**
 * The code blocks plugins draw in the document: which plugin draws a
 * language, and for each block shown, the way to change its source.
 */

/** Language -> the plugin that draws it. */
const languages = new Map<string, string>();
const languageListeners = new Set<() => void>();

function languagesChanged() {
  for (const listener of languageListeners) listener();
}

/** A plugin draws `language` until the returned function is called. */
export function addCodeBlockLanguage(
  language: string,
  plugin: string,
): () => void {
  languages.set(language, plugin);
  languagesChanged();
  return () => {
    if (languages.get(language) !== plugin) return;
    languages.delete(language);
    languagesChanged();
  };
}

/** The plugin that draws `language`, if one does. */
export function codeBlockPlugin(language: string): string | null {
  return languages.get(language.toLowerCase()) ?? null;
}

export function hasCodeBlockLanguages(): boolean {
  return languages.size > 0;
}

/** The editor redraws when a plugin starts or stops drawing a language. */
export function onCodeBlockLanguages(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

/**
 * The words after a fence's language: ` ```chart height=300 legend` is
 * { height: "300", legend: "true" }. A key given twice keeps the last.
 */
export function parseFenceMeta(meta: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pair = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S*)))?/g;
  for (const m of meta.matchAll(pair))
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "true";
  return out;
}

/** A drawn block's way back into the document. */
export interface DrawnCodeBlock {
  plugin: string;
  /** Replaces the block's source as one undo step; false when it is gone. */
  setSource(source: string): boolean;
}

const drawn = new Map<string, DrawnCodeBlock>();

export function trackCodeBlock(webview: string, block: DrawnCodeBlock): void {
  drawn.set(webview, block);
}

export function untrackCodeBlock(webview: string): void {
  drawn.delete(webview);
}

export function setCodeBlockSource(webview: string, source: string): boolean {
  return drawn.get(webview)?.setSource(source) ?? false;
}
