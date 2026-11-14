/**
 * Plugins that turn pasted text into Markdown of their own
 * (`editor.registerPasteHandler`): a URL into a titled link, a table into
 * Markdown. Each names the text it takes with a pattern, so any other
 * paste goes on as usual without asking anyone.
 */

type Provide = (text: string) => Promise<string | null>;

/** How long a plugin has to answer before the next is asked. */
const ANSWER_MS = 1500;
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
export async function providePaste(text: string): Promise<string | null> {
  for (const { provide } of takers(text)) {
    const markdown = await Promise.race([
      provide(text).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ANSWER_MS),
      ),
    ]);
    if (typeof markdown === "string") return markdown;
  }
  return null;
}
