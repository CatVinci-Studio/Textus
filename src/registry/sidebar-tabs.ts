import type { ComponentType, ReactNode } from "react";
import type { Strings } from "../i18n/strings";

/** A tab added to the sidebar beside Textus's own (a plugin's): its id
 *  (what ui-state remembers), its button's name and icon, and its panel. */
interface AddedSidebarTab {
  id: string;
  label: (t: Strings) => string;
  Icon: ComponentType;
  /** Drawn with nothing of the window's: it reaches what it needs itself. */
  Panel: () => ReactNode;
}

const added: AddedSidebarTab[] = [];
/** The ids Textus's own tabs hold: told by the window (app/frame). */
let own: (id: string) => boolean = () => false;

/** The window says which ids its own tabs hold, so none is added twice. */
export function reserveSidebarTabIds(isOwn: (id: string) => boolean): void {
  own = isOwn;
}

/** Adds a tab after the built-in ones; the returned function takes it
 *  away again. An id already taken is refused. */
export function registerSidebarTab(tab: AddedSidebarTab): () => void {
  if (own(tab.id) || added.some((t) => t.id === tab.id))
    throw new Error(`A sidebar tab "${tab.id}" is already registered.`);
  added.push(tab);
  return () => {
    const at = added.indexOf(tab);
    if (at >= 0) added.splice(at, 1);
  };
}

/** The tabs added, in the order they came. */
export function addedSidebarTabs(): readonly AddedSidebarTab[] {
  return added;
}
