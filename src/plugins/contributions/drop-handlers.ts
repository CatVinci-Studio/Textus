/**
 * Plugins that write a file dropped into a document as Markdown of their
 * own (`editor.registerDropHandler`): a CSV as a table, an audio file as a
 * player. Each names the files it takes by kind or extension, so any other
 * drop goes on as usual without asking anyone. Opening (Shift, a note, an
 * edge) never asks.
 */
import { firstAnswer } from "./first-answer";

/** As the drop sees a file; `fromSystem`: from a file manager, not yet
 *  copied anywhere. */
export interface DroppedFileInfo {
  path: string;
  name: string;
  kind: "image" | "attachment" | "note";
  fromSystem: boolean;
  /** The document it is dropped into; null for one never saved. */
  document: string | null;
}

export interface DropMatch {
  kinds: readonly string[];
  extensions: readonly string[];
}

type Provide = (file: DroppedFileInfo) => Promise<string | null>;

const handlers = new Map<
  string,
  { plugin: string; match: DropMatch; provide: Provide }
>();

/** A match as a plugin gives it: `{ kinds?, extensions? }`, at least one. */
export function dropMatch(value: unknown): DropMatch {
  const given = (value ?? {}) as { kinds?: unknown; extensions?: unknown };
  const list = (v: unknown, name: string) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
      throw new Error(`"${name}" must be a list of strings.`);
    return (v as string[]).map((x) => x.replace(/^\./, "").toLowerCase());
  };
  const match = {
    kinds: list(given.kinds, "kinds"),
    extensions: list(given.extensions, "extensions"),
  };
  if (!match.kinds.length && !match.extensions.length)
    throw new Error("A drop handler names the kinds or extensions it takes.");
  return match;
}

export function addDropHandler(
  plugin: string,
  id: string,
  match: DropMatch,
  provide: Provide,
): void {
  handlers.set(`${plugin}#${id}`, { plugin, match, provide });
}

export function removeDropHandler(plugin: string, id: string): void {
  handlers.delete(`${plugin}#${id}`);
}

export function forgetDropHandlers(plugin: string): void {
  for (const [key, handler] of handlers)
    if (handler.plugin === plugin) handlers.delete(key);
}

const extensionOf = (name: string) =>
  name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";

const takers = (name: string, kind: string) =>
  [...handlers.values()]
    .filter(
      ({ match }) =>
        match.kinds.includes(kind) ||
        match.extensions.includes(extensionOf(name)),
    )
    .sort((a, b) => a.plugin.localeCompare(b.plugin));

/** Whether a plugin takes a file of this name and kind. */
export function dropClaimed(name: string, kind: string): boolean {
  return takers(name, kind).length > 0;
}

/** The first Markdown a plugin has for `file`, in plugin id order; null:
 *  Textus writes it as it would. */
export function provideDrop(file: DroppedFileInfo): Promise<string | null> {
  return firstAnswer(takers(file.name, file.kind), ({ provide }) =>
    provide(file),
  );
}
