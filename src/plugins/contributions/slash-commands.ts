/**
 * The `/` menu: plugin commands put there (manifest `menus["editor/slash"]`,
 * registered by plugin-contributions.ts), offered at the caret when a word
 * starts with "/" - the completion list shows them (completion-sources.ts),
 * and taking one removes what was typed and runs the command.
 */
export interface SlashItem {
  label: string;
  /** Whose it is, beside the label. */
  detail: string;
  /** Whether it is offered now (its `when`). */
  shown: () => boolean;
  run: () => void;
}

const items = new Map<string, SlashItem[]>();

/** A plugin's `/` items, until the returned function takes them away. */
export function addSlashItems(plugin: string, list: SlashItem[]): () => void {
  items.set(plugin, list);
  return () => {
    if (items.get(plugin) === list) items.delete(plugin);
  };
}

export function hasSlashItems(): boolean {
  return items.size > 0;
}

/** "/" at a word's start, then what is typed after it. */
const SLASH = /(?:^|\s)(\/([\p{L}\p{N}-]*))$/u;

/** The items `text` (what is before the caret) asks for, and how much of
 *  it they replace; null when it isn't a "/" word or nothing matches. */
export function slashItemsFor(
  text: string,
): { replace: number; items: SlashItem[] } | null {
  const match = SLASH.exec(text);
  if (!match) return null;
  const query = match[2].toLowerCase();
  const found = [...items.values()]
    .flat()
    .filter((item) => item.label.toLowerCase().includes(query) && item.shown());
  return found.length ? { replace: match[1].length, items: found } : null;
}
