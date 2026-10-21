import { commandsCtx, editorViewCtx, type CmdKey } from "@milkdown/kit/core";
import {
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import {
  isInTable,
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  setCellAttr,
  CellSelection,
  selectionCell,
} from "@milkdown/kit/prose/tables";
import {
  NodeSelection,
  Selection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ContextMenuItem } from "./ContextMenu";
import { imageWidthOf, withImageWidth } from "./images/image-html";
import {
  imageLocation,
  revealNearest,
  type ImageLocation,
} from "./images/missing-image";
import { embedFileAt } from "./images/obsidian-embed-preview";
import { canRevealInFileManager } from "../platform/capabilities";
import type { EditorRunner } from "./useEditorRunner";
import { convertList } from "./keys/block-toggles";
import type { Strings } from "../i18n/strings";

// The editor commands behind the right-click menu, the native Format menu
// and the app-drawn Edit menu, and the right-click menu itself - plain
// functions over the editor runner, pulled out of MilkdownEditor.

type MenuEntry = ContextMenuItem | "separator";

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

function runTableCommand(
  run: EditorRunner,
  command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    command(view.state, view.dispatch);
    view.focus();
  });
}

// Grows the selection to the whole row/column of the current cell - both
// as its own menu action and as the first step of column alignment.
function selectTableLine(run: EditorRunner, kind: "row" | "column") {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const $cell = selectionCell(view.state);
    if (!$cell) return;
    const selection =
      kind === "row"
        ? CellSelection.rowSelection($cell)
        : CellSelection.colSelection($cell);
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  });
}

// Markdown table alignment is a per-COLUMN property (the `:---:` marker
// row), so aligning just the clicked cell serialized to something other
// than what the editor showed - align the whole column instead.
function alignTableColumn(
  run: EditorRunner,
  alignment: "left" | "center" | "right",
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const $cell = selectionCell(view.state);
    if (!$cell) return;
    view.dispatch(
      view.state.tr.setSelection(CellSelection.colSelection($cell)),
    );
    setCellAttr("alignment", alignment)(view.state, view.dispatch);
    // Back to a caret in the clicked cell rather than leaving the column
    // selected.
    view.dispatch(
      view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve($cell.pos + 1)),
      ),
    );
    view.focus();
  });
}

/** What the iPhone keyboard toolbar's table buttons send
 *  (TABLE_ACTION_EVENT) - the right-click menu's insert and delete items,
 *  by name. */
export const TABLE_ACTIONS = {
  "row-above": addRowBefore,
  "row-below": addRowAfter,
  "column-left": addColumnBefore,
  "column-right": addColumnAfter,
  "delete-row": deleteRow,
  "delete-column": deleteColumn,
  "delete-table": deleteTable,
} as const;
export type TableAction = keyof typeof TABLE_ACTIONS;

export function runTableAction(run: EditorRunner, action: string) {
  if (action in TABLE_ACTIONS)
    runTableCommand(run, TABLE_ACTIONS[action as TableAction]);
}

/** The image the selection is on - a tapped image is node-selected - for
 *  the keyboard toolbar's image buttons: its doc position, as
 *  contextMenuTarget reports the right-clicked one. */
export function selectedImagePos(run: EditorRunner): number | null {
  return (
    run((ctx) => {
      const { selection } = ctx.get(editorViewCtx).state;
      return selection instanceof NodeSelection &&
        selection.node.type.name === "image"
        ? selection.from
        : null;
    }) ?? null
  );
}

export function deleteImage(run: EditorRunner, pos: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  });
}

/**
 * `keepSelected`: the image stays selected, as the keyboard toolbar needs
 * it to keep showing the image's buttons - new markup on a leaf node is a
 * replacement, which otherwise maps a node selection on it to a caret.
 */
export function setImageWidth(
  run: EditorRunner,
  pos: number,
  widthPercent: number | null,
  keepSelected = false,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    const tr = view.state.tr.setNodeMarkup(
      pos,
      undefined,
      withImageWidth(node.attrs, widthPercent),
    );
    if (keepSelected) tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  });
}

/**
 * A right-click on a table cell other than the one being edited moves the
 * caret into it, so the table items act on the cell under the pointer. A
 * cell inside a cell selection keeps the selection, for Delete Row etc. on
 * several rows at once. A right-click outside any table while the caret is
 * in one moves the caret to the pointer: left where it was, the menu
 * offered the table's items for a click on a paragraph.
 */
function moveCaretToClickedCell(
  view: EditorView,
  target: EventTarget | null,
  coords: { left: number; top: number } | null,
) {
  const cell = target instanceof Element ? target.closest("td, th") : null;
  if (!cell || !view.dom.contains(cell)) {
    leaveTableForClick(view, target, coords);
    return;
  }
  let $inside;
  try {
    $inside = view.state.doc.resolve(view.posAtDOM(cell, 0));
  } catch {
    return;
  }
  let depth = $inside.depth;
  while (
    depth > 0 &&
    !$inside.node(depth).type.spec.tableRole?.endsWith("cell")
  )
    depth--;
  if (depth === 0) return;
  const cellStart = $inside.before(depth);
  const { selection } = view.state;
  if (selection instanceof CellSelection) {
    let covered = false;
    selection.forEachCell((_, pos) => {
      if (pos === cellStart) covered = true;
    });
    if (covered) return;
  } else if (
    isInTable(view.state) &&
    selectionCell(view.state).pos === cellStart
  ) {
    return;
  }
  const cellEnd = cellStart + $inside.node(depth).nodeSize - 1;
  view.dispatch(
    view.state.tr.setSelection(
      Selection.near(view.state.doc.resolve(cellEnd), -1),
    ),
  );
}

function leaveTableForClick(
  view: EditorView,
  target: EventTarget | null,
  coords: { left: number; top: number } | null,
) {
  const { selection } = view.state;
  const inTable =
    selection instanceof CellSelection ||
    (selection.empty && isInTable(view.state));
  if (!inTable || !coords) return;
  if (!(target instanceof Node) || !view.dom.contains(target)) return;
  const hit = view.posAtCoords(coords);
  if (!hit) return;
  view.dispatch(
    view.state.tr.setSelection(Selection.near(view.state.doc.resolve(hit.pos))),
  );
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
  copyOrCut: (cut: boolean) => void;
  copyAsMarkdown: () => void;
  paste: () => void;
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
  );
  if (imageItems.length > 0) imageItems.push("separator");
  const clipboardItems: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copy, onSelect: () => options.copyOrCut(false) },
    { label: t.copyAsMarkdown, onSelect: options.copyAsMarkdown },
    { label: t.paste, onSelect: options.paste },
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
 * Copy as Markdown, which the toolbar lacks. The
 * caller leaves Ask AI out of aiItems: the toolbar has its own button.
 */
export function buildPhoneMoreItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos } = options;
  // The toolbar has Copy, but not the Markdown source: the phone has no
  // Edit menu to offer it.
  const clipboard: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copyAsMarkdown, onSelect: options.copyAsMarkdown },
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

function inTable(run: EditorRunner): boolean {
  return run((ctx) => isInTable(ctx.get(editorViewCtx).state)) ?? false;
}

function imageWidthItems(
  run: EditorRunner,
  t: Strings,
  imagePos: number,
): MenuEntry[] {
  const currentWidth =
    run((ctx) => {
      const node = ctx.get(editorViewCtx).state.doc.nodeAt(imagePos);
      return node?.type.name === "image" ? imageWidthOf(node.attrs) : null;
    }) ?? null;
  // A width written by hand - "320", "45%" - ticks none of them.
  const widthItem = (widthPercent: number | null, label: string) => ({
    label: `${currentWidth === (widthPercent && `${widthPercent}%`) ? "✓ " : ""}${label}`,
    onSelect: () => setImageWidth(run, imagePos, widthPercent),
  });
  return [
    widthItem(null, t.imageWidthAuto),
    widthItem(30, t.imageWidth30),
    widthItem(50, t.imageWidth50),
    widthItem(70, t.imageWidth70),
    widthItem(100, t.imageWidth100),
  ];
}

/**
 * Show in folder and Copy image path. Show in folder goes where the
 * missing image card's button does (revealNearest): the file selected, or
 * the nearest folder that exists. A web image has only its address to
 * copy; a data: URI, nothing.
 */
function imageFileItems(
  t: Strings,
  location: ImageLocation | null,
): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (location?.kind === "local" && canRevealInFileManager)
    items.push({
      label: t.imageReveal,
      onSelect: () => revealNearest(location.path),
    });
  const text =
    location?.kind === "local"
      ? location.path
      : location?.kind === "remote"
        ? location.url
        : null;
  if (text !== null)
    items.push({
      label: t.imageCopyPath,
      onSelect: () => void navigator.clipboard.writeText(text).catch(() => {}),
    });
  return items;
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

/** Column alignment and row/column selection. */
function tableLayoutItems(run: EditorRunner, t: Strings): MenuEntry[] {
  return [
    { label: t.alignLeft, onSelect: () => alignTableColumn(run, "left") },
    { label: t.alignCenter, onSelect: () => alignTableColumn(run, "center") },
    { label: t.alignRight, onSelect: () => alignTableColumn(run, "right") },
    "separator",
    { label: t.selectRow, onSelect: () => selectTableLine(run, "row") },
    { label: t.selectColumn, onSelect: () => selectTableLine(run, "column") },
  ];
}

/** Inserting and deleting rows and columns. */
function tableEditItems(run: EditorRunner, t: Strings): MenuEntry[] {
  const table = (action: TableAction) => () => runTableAction(run, action);
  return [
    { label: t.insertRowAbove, onSelect: table("row-above") },
    { label: t.insertRowBelow, onSelect: table("row-below") },
    { label: t.insertColumnLeft, onSelect: table("column-left") },
    { label: t.insertColumnRight, onSelect: table("column-right") },
    "separator",
    { label: t.deleteRow, onSelect: table("delete-row"), danger: true },
    { label: t.deleteColumn, onSelect: table("delete-column"), danger: true },
    { label: t.deleteTable, onSelect: table("delete-table"), danger: true },
  ];
}
