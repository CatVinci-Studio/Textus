import { commandsCtx, editorViewCtx, type CmdKey } from "@milkdown/kit/core";
import {
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { ContextMenuItem } from "./ContextMenu";
import { imageLocation, type ImageLocation } from "./images/missing-image";
import { embedFileAt } from "./images/obsidian-embed-preview";
import type { EditorRunner } from "./useEditorRunner";
import { convertList } from "./keys/block-toggles";
import type { Strings } from "../i18n/strings";
import {
  inTable,
  moveCaretToClickedCell,
  tableEditItems,
  tableLayoutItems,
} from "./editor-menu-tables";
import { imageFileItems, imageWidthItems } from "./editor-menu-images";
export {
  TABLE_ACTIONS,
  type TableAction,
  runTableAction,
} from "./editor-menu-tables";
export {
  selectedImagePos,
  selectImage,
  deleteImage,
  setImageWidth,
} from "./editor-menu-images";
// The editor commands behind the right-click menu, the native Format menu
// and the app-drawn Edit menu, and the right-click menu itself - plain
// functions over the editor runner, pulled out of MilkdownEditor.

export type MenuEntry = ContextMenuItem | "separator";

// CmdKey<any>: the preset command keys vary in payload type (some
// unknown, some undefined) and all are called here without a payload.
export function runCommand(run: EditorRunner, key: CmdKey<any>) {
  run((ctx) => {
    ctx.get(commandsCtx).call(key);
    ctx.get(editorViewCtx).focus();
  });
}

export function insertTable(run: EditorRunner, rows: number, cols: number) {
  run((ctx) => {
    ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
  });
}

export function insertHeading(run: EditorRunner, level: number) {
  run((ctx) => {
    ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
    ctx.get(editorViewCtx).focus();
  });
}

/** What a right-click landed on, for the menu's image items. */
export interface ContextMenuTarget {
  /** The image node's doc position, for the width items. */
  imagePos: number | null;
  /** Where the picture's file is - an image's or an Obsidian embed's -
   *  for Show in folder and Copy image path. */
  imageLocation: ImageLocation | null;
}

/**
 * Prepares the editor for a right-click and reports the image under the
 * pointer, if any.
 *
 * macOS WebKit selects the word under the pointer while handling a right
 * click in editable content - inside the engine, before any DOM event, so
 * it can't be prevented. But by the time contextmenu fires, only the DOM
 * selection has moved; ProseMirror's state still holds the real selection
 * (its readback is async). Pushing the state's selection back into the DOM
 * here undoes the word-select before it's ever painted or read back, so AI
 * context capture and the completion cursor never see it.
 */
export function contextMenuTarget(
  run: EditorRunner,
  e: { target: EventTarget | null; clientX?: number; clientY?: number },
  docPath: string | null,
): ContextMenuTarget {
  const none = { imagePos: null, imageLocation: null };
  return (
    run((ctx): ContextMenuTarget => {
      const view = ctx.get(editorViewCtx);
      const coords =
        e.clientX === undefined || e.clientY === undefined
          ? null
          : { left: e.clientX, top: e.clientY };
      moveCaretToClickedCell(view, e.target, coords);
      const { anchor, head } = view.state.selection;
      try {
        const a = view.domAtPos(anchor);
        const h = view.domAtPos(head);
        window
          .getSelection()
          ?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
      } catch {
        // Selection not representable in the DOM right now - leave it alone.
      }

      const target =
        e.target instanceof Element ? e.target.closest(".image-view") : null;
      if (!target) return none;
      const embedFile = embedFileAt(target);
      if (embedFile)
        return {
          imagePos: null,
          imageLocation: { kind: "local", path: embedFile },
        };
      try {
        const pos = view.posAtDOM(target, 0);
        const node = view.state.doc.nodeAt(pos);
        if (node?.type.name !== "image") return none;
        // Selected, so Copy and Cut take the picture right-clicked.
        view.dispatch(
          view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
        );
        return {
          imagePos: pos,
          imageLocation: imageLocation(
            (node.attrs.src as string) ?? "",
            docPath,
          ),
        };
      } catch {
        return none;
      }
    }) ?? none
  );
}

export interface ContextMenuOptions {
  t: Strings;
  /** From contextMenuTarget: the image right-clicked, if any. */
  imagePos: number | null;
  imageLocation?: ImageLocation | null;
  /** Already filtered down to the AI features that are switched on. */
  aiItems: ContextMenuItem[];
  /** For the image right-clicked: Textus AI's items for it (changing it),
   *  among the image's own. */
  pictureAiItems?: ContextMenuItem[];
  copyOrCut: (cut: boolean) => void;
  copyAsPlainText: () => void;
  paste: () => void;
  pasteAsPlainText: () => void;
  selectAll: () => void;
  toggleFindReplace: () => void;
  openTableDialog: () => void;
}

export function buildContextMenuItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos } = options;
  const imageItems = joinGroups(
    imagePos === null ? [] : imageWidthItems(run, t, imagePos),
    imageFileItems(t, options.imageLocation ?? null),
    imagePos === null ? [] : (options.pictureAiItems ?? []),
  );
  if (imageItems.length > 0) imageItems.push("separator");
  const clipboardItems: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copy, onSelect: () => options.copyOrCut(false) },
    { label: t.copyAsPlainText, onSelect: options.copyAsPlainText },
    { label: t.paste, onSelect: options.paste },
    { label: t.pasteAsPlainText, onSelect: options.pasteAsPlainText },
    ...withSeparator(contributedMenuItems({ selectedText: selectedText(run) })),
    ...generalItems(options),
  ];

  if (!inTable(run)) {
    return [
      ...imageItems,
      ...clipboardItems,
      "separator",
      ...insertItems(run, options),
    ];
  }
  return [
    ...imageItems,
    ...clipboardItems,
    "separator",
    ...tableLayoutItems(run, t),
    "separator",
    ...tableEditItems(run, t),
  ];
}

/**
 * The iPhone's "More" sheet (the keyboard toolbar's last button), which
 * stands in for the right-click menu a phone never opens: what that menu
 * offers where the caret is, less what the toolbar already carries there -
 * copy and paste always, the insert and delete buttons in a table, the
 * width presets on an image, lists, quote and code block elsewhere - and
 * Copy as Plain Text, which the toolbar lacks. The
 * caller leaves Ask AI out of aiItems: the toolbar has its own button.
 */
export function buildPhoneMoreItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos } = options;
  // The toolbar has Copy, but not the plain text: the phone has no Edit
  // menu to offer it.
  const clipboard: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copyAsPlainText, onSelect: options.copyAsPlainText },
  ];
  if (inTable(run)) {
    return [
      ...tableLayoutItems(run, t),
      "separator",
      ...clipboard,
      ...generalItems(options),
    ];
  }
  if (imagePos !== null) return [...clipboard, ...generalItems(options)];
  return [
    { label: t.insertTable, onSelect: options.openTableDialog },
    "separator",
    ...clipboard,
    ...generalItems(options),
  ];
}

/** The groups that have items, a separator between each two. */
function joinGroups(...groups: MenuEntry[][]): MenuEntry[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, i) =>
      i === 0 ? group : ["separator" as const, ...group],
    );
}

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

/** A group of items with the separator before it, or nothing. */
function withSeparator(items: ContextMenuItem[]): MenuEntry[] {
  return items.length > 0 ? ["separator", ...items] : [];
}

function selectedText(run: EditorRunner): string {
  return (
    run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.doc.textBetween(
        state.selection.from,
        state.selection.to,
        "\n",
      );
    }) ?? ""
  );
}

/** Select All, Find, and the AI items: offered wherever the caret is. */
function generalItems(options: ContextMenuOptions): MenuEntry[] {
  const { t, aiItems } = options;
  return [
    { label: t.selectAll, onSelect: options.selectAll },
    "separator",
    { label: t.findReplace, onSelect: options.toggleFindReplace },
    ...(aiItems.length > 0 ? (["separator", ...aiItems] as MenuEntry[]) : []),
  ];
}

/** A list from the Format or Insert menu: the block wrapped in one, or -
 *  in a list of the other kind - that list changed over (convertList). */
export function insertList(
  run: EditorRunner,
  kind: "bullet_list" | "ordered_list",
): void {
  if (run((ctx) => convertList(ctx.get(editorViewCtx), kind))) return;
  runCommand(
    run,
    kind === "bullet_list"
      ? wrapInBulletListCommand.key
      : wrapInOrderedListCommand.key,
  );
}

function insertItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t } = options;
  return [
    {
      label: t.insertBulletList,
      onSelect: () => insertList(run, "bullet_list"),
    },
    {
      label: t.insertOrderedList,
      onSelect: () => insertList(run, "ordered_list"),
    },
    {
      label: t.insertBlockquote,
      onSelect: () => runCommand(run, wrapInBlockquoteCommand.key),
    },
    {
      label: t.insertCodeBlock,
      onSelect: () => runCommand(run, createCodeBlockCommand.key),
    },
    { label: t.insertTable, onSelect: options.openTableDialog },
  ];
}
