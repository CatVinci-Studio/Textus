import type { SentBlock } from "../ai/doc-blocks";

/**
 * The plugins that mark the document's text (textus.editor.register
 * Decorations): asked for the blocks in sight, and again when those
 * change. The editor's side (editor/marks/plugin-decorations.ts) draws
 * what they answer.
 */
export interface PluginDecoration {
  block: string;
  anchor?: string;
  style: "highlight" | "underline" | "muted" | "badge";
  tone?: "accent" | "warning" | "danger" | "success";
  text?: string;
  tooltip?: string;
}

type Ask = (blocks: SentBlock[]) => Promise<PluginDecoration[]>;

const providers = new Map<string, Ask>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
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
export function onDecorationProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every plugin's marks for `blocks`, each tagged with whose it is; a
 *  plugin that fails or takes too long adds none. */
export async function decorate(
  blocks: SentBlock[],
  timeoutMs = 1500,
): Promise<(PluginDecoration & { plugin: string })[]> {
  const all = await Promise.all(
    [...providers].map(async ([plugin, ask]) => {
      const marks = await Promise.race([
        ask(blocks).catch(() => []),
        new Promise<PluginDecoration[]>((resolve) =>
          setTimeout(() => resolve([]), timeoutMs),
        ),
      ]);
      return (Array.isArray(marks) ? marks : [])
        .filter((m) => m && typeof m.block === "string")
        .map((m) => ({ ...m, plugin }));
    }),
  );
  return all.flat();
}
