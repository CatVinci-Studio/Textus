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
import type { ContextMenuEntry, ContextMenuItem } from "../ui/ContextMenu";
import { contributedMenuItems } from "./editor-menu-items";
export {
  registerEditorMenuItems,
  type EditorMenuContext,
  type EditorMenuProvider,
} from "./editor-menu-items";
import { imageLocation, type ImageLocation } from "./images/missing-image";
import { embedFileAt } from "./images/obsidian-embed-preview";
import type { EditorRunner } from "./useEditorRunner";
import { convertList } from "./keys/block-toggles";
import type { Strings } from "../i18n/strings";
import {
  inTable,
  moveCaretToClickedCell,
  tableLayoutItems,
  tableMenuItems,
} from "./editor-menu-tables";
import {
  imageFileItems,
  imageTurnItems,
  imageWidthItems,
} from "./editor-menu-images";
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
  rotateImage,
} from "./editor-menu-images";
// The editor commands behind the right-click, Format and Edit menus, and
// the right-click menu itself.

export type MenuEntry = ContextMenuEntry;

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
  /** Where the picture's file is, for Show in folder and Copy image path. */
  imageLocation: ImageLocation | null;
}

/**
 * Prepares the editor for a right-click and reports the image under the
 * pointer. macOS WebKit selects the word under the pointer before any DOM
 * event; pushing the state's selection back into the DOM undoes it.
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
        // Not representable in the DOM right now.
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
  /** Textus AI's items for the image right-clicked. */
  pictureAiItems?: ContextMenuItem[];
  copyOrCut: (cut: boolean) => void;
  copyAsPlainText: () => void;
  paste: () => void;
  pasteAsPlainText: () => void;
  selectAll: () => void;
  toggleFindReplace: () => void;
  openTableDialog: () => void;
  /** A note of the writer's own on the selection, offered while there is one. */
  addNote?: () => void;
  /** Accept or reject all of the writer's tracked changes, while there are some. */
  ownChanges?: { acceptAll: () => void; rejectAll: () => void };
}

export function buildContextMenuItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos } = options;
  const imageItems = joinGroups(
    imagePos === null ? [] : imageWidthItems(run, t, imagePos),
    imageFileItems(t, options.imageLocation ?? null),
    imagePos === null ? [] : imageTurnItems(run, t, imagePos),
    imagePos === null ? [] : (options.pictureAiItems ?? []),
  );
  const clipboard: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copy, onSelect: () => options.copyOrCut(false) },
    { label: t.copyAsPlainText, onSelect: options.copyAsPlainText },
    { label: t.paste, onSelect: options.paste },
    { label: t.pasteAsPlainText, onSelect: options.pasteAsPlainText },
    ...(options.addNote && selectedText(run)
      ? [{ label: t.ownNoteAdd, onSelect: options.addNote }]
      : []),
  ];
  const ownChanges: MenuEntry[] = options.ownChanges
    ? [
        { label: t.trackAcceptAll, onSelect: options.ownChanges.acceptAll },
        { label: t.trackRejectAll, onSelect: options.ownChanges.rejectAll },
      ]
    : [];
  // What was clicked on comes first; the rest waits in submenus.
  const first = inTable(run) ? tableMenuItems(run, t) : imageItems;
  const insert: MenuEntry[] = inTable(run)
    ? []
    : [{ label: t.menuGroupInsert, items: insertItems(run, options) }];
  return joinGroups(
    first,
    clipboard,
    ownChanges,
    [...insert, ...grouped(t.menuTextusAi, options.aiItems)],
    grouped(
      t.menuPlugins,
      contributedMenuItems({ selectedText: selectedText(run) }),
      2,
    ),
  );
}

/** Items as one submenu once there are more than `max`. */
function grouped(
  label: string,
  items: ContextMenuItem[],
  max = 1,
): MenuEntry[] {
  return items.length > max ? [{ label, items }] : items;
}

/**
 * The iPhone's "More" sheet, standing in for the right-click menu: what it
 * offers where the caret is, less what the keyboard toolbar already carries.
 * The caller leaves Ask AI out of aiItems.
 */
export function buildPhoneMoreItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos } = options;
  // The phone has no Edit menu to offer the plain text.
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

/** A list from the Format or Insert menu: the block wrapped in one, or a
 *  list of the other kind changed over. */
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
): ContextMenuItem[] {
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
