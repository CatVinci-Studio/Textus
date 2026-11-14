import type { SentBlock } from "../../editor/markdown/doc-blocks";

/**
 * Plugins that add to the outline (`editor.registerOutline`): a
 * screenplay's scenes, a novel's characters, under the headings, each row
 * going to its block.
 */
export interface PluginOutlineItem {
  text: string;
  /** 1 to 6, as a heading's: how far in it sits. */
  level: number;
  block: string;
  plugin: string;
}

type Provide = (blocks: SentBlock[]) => Promise<unknown>;

const ANSWER_MS = 1500;
const MAX_ITEMS = 500;
const providers = new Map<string, Provide>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function addOutlineProvider(plugin: string, provide: Provide): void {
  providers.set(plugin, provide);
  changed();
}

export function removeOutlineProvider(plugin: string): void {
  if (providers.delete(plugin)) changed();
}

export function onOutlineProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function itemsOf(plugin: string, answer: unknown): PluginOutlineItem[] {
  return (Array.isArray(answer) ? answer : []).flatMap((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    if (typeof item.text !== "string" || typeof item.block !== "string")
      return [];
    const level = Math.min(6, Math.max(1, Math.round(Number(item.level) || 1)));
    return [{ text: item.text, block: item.block, level, plugin }];
  });
}

/** Every plugin's rows for the document of `blocks`, plugins in id order;
 *  one that fails or is slow adds none. */
export async function askOutline(
  blocks: SentBlock[],
): Promise<PluginOutlineItem[]> {
  const asked = [...providers]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(async ([plugin, provide]) =>
      itemsOf(
        plugin,
        await Promise.race([
          provide(blocks).catch(() => []),
          new Promise((resolve) => setTimeout(() => resolve([]), ANSWER_MS)),
        ]),
      ),
    );
  return (await Promise.all(asked)).flat().slice(0, MAX_ITEMS);
}
