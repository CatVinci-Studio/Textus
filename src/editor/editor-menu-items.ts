import type { ContextMenuItem } from "./ContextMenu";

/**
 * Items added to the editor's right-click menu from outside - plugins,
 * plugin-api.ts - apart from editor-menu.ts and the editor it needs, so
 * what registers them doesn't load the editor at startup.
 */

/** What an item added to the editor's menu is told: the text selected,
 *  empty for none. */
export interface EditorMenuContext {
  selectedText: string;
}

/** Items added to the editor's menu from outside (docs/dev/plugin-api.md):
 *  each provider is asked when the menu opens, and its items are a group
 *  of their own before Select All. */
export type EditorMenuProvider = (
  context: EditorMenuContext,
) => ContextMenuItem[];

const menuProviders: EditorMenuProvider[] = [];

/** Adds items to the editor's right-click menu; the returned function
 *  takes them away again. */
export function registerEditorMenuItems(
  provider: EditorMenuProvider,
): () => void {
  menuProviders.push(provider);
  return () => {
    const at = menuProviders.indexOf(provider);
    if (at >= 0) menuProviders.splice(at, 1);
  };
}

/** The added items for a menu opened on `selectedText`. A provider that
 *  throws adds nothing rather than taking the menu down. */
export function contributedMenuItems(
  context: EditorMenuContext,
): ContextMenuItem[] {
  return menuProviders.flatMap((provide) => {
    try {
      return provide(context);
    } catch {
      return [];
    }
  });
}
