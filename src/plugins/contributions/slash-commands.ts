import {
  addCompletionSource,
  type PanelItem,
} from "../../editor/extension-points";
import { windowInfo } from "../store/plugin-records";

/**
 * The `/` commands: plugin commands offered at the caret when a word starts
 * with "/" - the core's `textus.slash` source of the / panel. Taking one
 * removes what was typed and runs the command.
 */
interface SlashItem {
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

/** The items offered now, as the panel lists them. */
export function slashPanelItems(): PanelItem[] {
  const out: PanelItem[] = [];
  for (const list of items.values())
    for (const item of list)
      if (item.shown())
        out.push({
          label: item.label,
          insert: "",
          detail: item.detail,
          keywords: item.keywords,
          run: item.run,
        });
  return out;
}

addCompletionSource({
  id: "textus.slash",
  owner: "core",
  where: "text",
  // "/" at a word's start, then what is typed after it.
  pattern: /(?:^|\s)(\/([\p{L}\p{N}-]*))$/u,
  replaceGroup: 1,
  title: () => windowInfo().strings().completionCommands,
  provide: () => {
    if (!items.size) return null;
    const list = slashPanelItems();
    return list.length ? { items: list, complete: true } : null;
  },
});
