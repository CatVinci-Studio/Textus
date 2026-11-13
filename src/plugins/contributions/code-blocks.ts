import {
  claim,
  claimKey,
  claimsStartingWith,
  onOwnersChanged,
  ownerOf,
} from "./owners";

/**
 * The code blocks plugins draw in the document: which plugin draws a
 * language, and for each block shown, the way to change its source.
 */

/** "language plugin" -> drawn without the box round it. */
const frameless = new Set<string>();
/** "language plugin" -> drawn at the interface's size. */
const interfaceSized = new Set<string>();

const claimOf = claimKey.codeBlock;

/** A plugin draws `language` until the returned function is called; while
 *  another one draws it, this one waits its turn. */
export function addCodeBlockLanguage(
  language: string,
  plugin: string,
  frame?: "none",
  size?: "interface",
): () => void {
  const key = `${language.toLowerCase()} ${plugin}`;
  if (frame === "none") frameless.add(key);
  else frameless.delete(key);
  if (size === "interface") interfaceSized.add(key);
  else interfaceSized.delete(key);
  const release = claim(claimOf(language), plugin);
  return () => {
    frameless.delete(key);
    interfaceSized.delete(key);
    release();
  };
}

/** Whether `language`'s blocks go without the box round them. */
export function codeBlockFrameless(language: string): boolean {
  const owner = codeBlockPlugin(language);
  return !!owner && frameless.has(`${language.toLowerCase()} ${owner}`);
}

/** Whether `language`'s blocks are drawn at the interface's size, not the
 *  document's text and zoom. */
export function codeBlockAtInterfaceSize(language: string): boolean {
  const owner = codeBlockPlugin(language);
  return !!owner && interfaceSized.has(`${language.toLowerCase()} ${owner}`);
}

/** The plugin that draws `language`, if one does. */
export function codeBlockPlugin(language: string): string | null {
  return ownerOf(claimOf(language));
}

export function hasCodeBlockLanguages(): boolean {
  return claimsStartingWith(claimKey.codeBlock("")).length > 0;
}

/** The editor redraws when a plugin starts or stops drawing a language. */
export function onCodeBlockLanguages(listener: () => void): () => void {
  return onOwnersChanged(listener);
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
interface DrawnCodeBlock {
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
