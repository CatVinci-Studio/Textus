/**
 * Plugins that turn pasted text into Markdown of their own
 * (`editor.registerPasteHandler`): a URL into a titled link, a table into
 * Markdown. Each names the text it takes with a pattern, so any other
 * paste goes on as usual without asking anyone.
 */

import { firstAnswer } from "./first-answer";
import { pluginHandlers } from "./plugin-handlers";

type Provide = (text: string) => Promise<string | null>;

/** More than this is no "snippet" to look at. */
const MAX_TEXT = 20_000;

const handlers = pluginHandlers<{ pattern: RegExp; provide: Provide }>();

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
  handlers.add(plugin, id, { pattern, provide });
}

export function removePasteHandler(plugin: string, id: string): void {
  handlers.remove(plugin, id);
}

export function forgetPasteHandlers(plugin: string): void {
  handlers.forget(plugin);
}

const takers = (text: string) =>
  text.length > MAX_TEXT
    ? []
    : handlers
        .all()
        .filter((h) => h.pattern.test(text))
        .sort((a, b) => a.plugin.localeCompare(b.plugin));

export function pasteMatches(text: string): boolean {
  return takers(text).length > 0;
}

/** The first Markdown a plugin has for `text`, in plugin id order. */
export function providePaste(text: string): Promise<string | null> {
  return firstAnswer(takers(text), ({ provide }) => provide(text));
}
