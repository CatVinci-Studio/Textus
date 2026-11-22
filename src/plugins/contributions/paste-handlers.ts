/**
 * Plugins that turn pasted text into Markdown of their own
 * (`editor.registerPasteHandler`): a URL into a titled link, a table into
 * Markdown. Each names the text it takes with a pattern, so any other
 * paste goes on as usual without asking anyone.
 */

import { firstAnswer } from "./first-answer";

type Provide = (text: string) => Promise<string | null>;

/** More than this is no "snippet" to look at. */
const MAX_TEXT = 20_000;

const handlers = new Map<
  string,
  { plugin: string; pattern: RegExp; provide: Provide }
>();

/** A pattern as a plugin gives it: a regular expression, unicode. */
export function pastePattern(source: string): RegExp {
  try {
    return new RegExp(source, "u");
  } catch {
    throw new Error(`"${source}" is not a regular expression.`);
  }
}

export function addPasteHandler(
  plugin: string,
  id: string,
  pattern: RegExp,
  provide: Provide,
): void {
  handlers.set(`${plugin}#${id}`, { plugin, pattern, provide });
}

export function removePasteHandler(plugin: string, id: string): void {
  handlers.delete(`${plugin}#${id}`);
}

export function forgetPasteHandlers(plugin: string): void {
  for (const [key, handler] of handlers)
    if (handler.plugin === plugin) handlers.delete(key);
}

const takers = (text: string) =>
  text.length > MAX_TEXT
    ? []
    : [...handlers.values()]
        .filter((h) => h.pattern.test(text))
        .sort((a, b) => a.plugin.localeCompare(b.plugin));

export function pasteMatches(text: string): boolean {
  return takers(text).length > 0;
}

/** The first Markdown a plugin has for `text`, in plugin id order. */
export function providePaste(text: string): Promise<string | null> {
  return firstAnswer(takers(text), ({ provide }) => provide(text));
}
