import type { SentBlock } from "../../editor/markdown/doc-blocks";
import { createSubscribers } from "../../utils/store";

/**
 * The plugins that mark the document's text: asked for the blocks in sight,
 * and again when those change.
 */
export interface PluginDecoration {
  block: string;
  anchor?: string;
  style: "highlight" | "underline" | "muted" | "badge" | "gutter";
  tone?: "accent" | "warning" | "danger" | "success";
  text?: string;
  tooltip?: string;
  /** For "badge": before the words rather than after (a number). */
  before?: boolean;
  /** The words link here (http, https, mailto), followed as a link is. */
  url?: string;
  /** For "gutter": a plugin's SVG or one or two characters; a dot without. */
  icon?: string;
  /** For "gutter": the plugin's command a click runs. */
  command?: { id: string; args?: unknown[] };
}

/** A mark's link, when it is one a click may follow. */
export function markUrl(url: unknown): string | null {
  return typeof url === "string" &&
    /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(url)
    ? url
    : null;
}

/** `blocks` in sight, and the whole document they're of: the asking
 *  editor's, which needn't be the one in front, with its path (null for
 *  one not saved yet). */
type Ask = (
  blocks: SentBlock[],
  all: readonly SentBlock[],
  path: string | null,
) => Promise<PluginDecoration[]>;

const providers = new Map<string, Ask>();
const subscribers = createSubscribers();

function changed() {
  subscribers.publish();
}

export function addDecorationProvider(plugin: string, ask: Ask): void {
  providers.set(plugin, ask);
  changed();
}

export function removeDecorationProvider(plugin: string): void {
  if (providers.delete(plugin)) changed();
}

export function hasDecorationProviders(): boolean {
  return providers.size > 0;
}

/** The editor redraws when a plugin starts or stops marking. */
export const onDecorationProviders = subscribers.subscribe;

/** Every plugin's marks for `blocks`, each tagged with whose it is. One
 *  that fails adds none; one that takes too long is named as late, so its
 *  marks from before stay. */
export async function decorate(
  blocks: SentBlock[],
  doc: readonly SentBlock[],
  path: string | null = null,
  timeoutMs = 1500,
): Promise<{
  answers: (PluginDecoration & { plugin: string })[];
  late: string[];
}> {
  const late: string[] = [];
  const all = await Promise.all(
    [...providers].map(async ([plugin, ask]) => {
      const marks = await Promise.race([
        ask(blocks, doc, path).catch(() => []),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs),
        ),
      ]);
      if (marks === null) late.push(plugin);
      return (Array.isArray(marks) ? marks : [])
        .filter((m) => m && typeof m.block === "string")
        .map((m) => ({ ...m, plugin }));
    }),
  );
  return { answers: all.flat(), late };
}
