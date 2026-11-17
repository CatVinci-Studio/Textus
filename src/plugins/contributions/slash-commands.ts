import {
  addCompletionSource,
  type PanelItem,
} from "../../editor/extension-points";
import { menuKinds } from "../../editor/blocks/block-kind-list";
import { INSERT_BLOCK_EVENT, sendAppEvent } from "../../utils/events";
import { windowInfo } from "../store/plugin-records";
import { currentStrings } from "../../i18n/current";

/**
 * The `/` menu - the core's `textus.slash` source of the / panel, offered
 * when a word starts with "/". It lists Textus's own blocks while a plugin
 * asks for them (`contributes.blockMenu`), then what plugins add: their
 * `editor/slash` commands and the block types they register. Taking one
 * removes what was typed and runs it.
 */
interface SlashItem {
  label: string;
  /** Whose it is, beside the label. */
  detail: string;
  /** Also found by: its English name, in another language. */
  keywords?: string;
  /** Whether it is offered now (its `when`). */
  shown: () => boolean;
  /** Put in over what was typed (`$0` the caret), before `run`. */
  insert?: string;
  run?: () => void;
}

/** A block the `/` menu offers, as plugins read the list. */
interface BlockType {
  id: string;
  label: string;
  /** "textus" for the app's own, else the plugin's id. */
  source: string;
}

/** Each plugin's items, by the plugin's id (its manifest's) or by
 *  `<plugin id>#<block type id>` (one it registered). */
const items = new Map<string, { plugin: string; list: SlashItem[] }>();
/** The plugins on that asked for Textus's blocks. */
const blockMenuPlugins = new Set<string>();

/** A plugin's `/` items, until the returned function takes them away. */
export function addSlashItems(
  plugin: string,
  list: SlashItem[],
  key = plugin,
): () => void {
  const entry = { plugin, list };
  items.set(key, entry);
  return () => {
    if (items.get(key) === entry) items.delete(key);
  };
}

/** Textus's own blocks in the `/` menu while `plugin` is on. */
export function askBlockMenu(plugin: string): () => void {
  blockMenuPlugins.add(plugin);
  return () => blockMenuPlugins.delete(plugin);
}

/** The app's blocks: the Format menu's, three heading levels. */
function coreItems(): SlashItem[] {
  if (!blockMenuPlugins.size) return [];
  const t = currentStrings();
  return menuKinds().map((kind) => ({
    label: kind.label(t),
    detail: "",
    keywords: kind.id.replace(/-/g, " "),
    shown: () => true,
    run: () => sendAppEvent(INSERT_BLOCK_EVENT, kind.id),
  }));
}

/** Every block type the `/` menu can offer now, the app's first. */
export function blockTypeList(): BlockType[] {
  const t = currentStrings();
  const own = menuKinds().map((kind) => ({
    id: kind.id,
    label: kind.label(t),
    source: "textus",
  }));
  const added = [...items.entries()].flatMap(([key, { plugin, list }]) =>
    list
      .filter((item) => item.shown())
      .map((item) => ({
        id: key.includes("#") ? key.slice(key.indexOf("#") + 1) : item.label,
        label: item.label,
        source: plugin,
      })),
  );
  return [...own, ...added];
}

/** The items offered now, as the panel lists them. */
export function slashPanelItems(): PanelItem[] {
  const all = [...coreItems(), ...[...items.values()].flatMap((e) => e.list)];
  return all
    .filter((item) => item.shown())
    .map((item) => ({
      label: item.label,
      insert: item.insert ?? "",
      detail: item.detail,
      keywords: item.keywords,
      run: item.run,
    }));
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
    if (!items.size && !blockMenuPlugins.size) return null;
    const list = slashPanelItems();
    return list.length ? { items: list, complete: true } : null;
  },
});
