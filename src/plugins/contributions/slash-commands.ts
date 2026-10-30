import { quickPickMatches } from "../../ui/quick-pick";

/**
 * The `/` menu: plugin commands offered at the caret when a word starts with
 * "/". Taking one removes what was typed and runs the command.
 */
export interface SlashItem {
  label: string;
  /** Whose it is, beside the label. */
  detail: string;
  /** Also found by: its English name, in another language. */
  keywords?: string;
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
  const query = match[2];
  // As the palette finds them: by any word, or a Chinese name by pinyin.
  const found = [...items.values()]
    .flat()
    .filter(
      (item) =>
        quickPickMatches(
          { label: item.label, description: item.keywords },
          query,
        ) && item.shown(),
    );
  return found.length ? { replace: match[1].length, items: found } : null;
}
