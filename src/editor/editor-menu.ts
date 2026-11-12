import { fill } from "../i18n/fill";
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
import type {
  ContextMenuEntry,
  ContextMenuItem,
} from "../engine/controls/ContextMenu";
import { contributedMenuItems } from "./editor-menu-items";
import { linkMenuItems, menuLinkAt, type MenuLink } from "./editor-menu-links";
import { imageLocation, type ImageLocation } from "./images/missing-image";
import { embedFileAt } from "./images/obsidian-embed-preview";
import {
  drawnBlockActionsAt,
  type DrawnBlockActions,
} from "./drawn-block-actions";
import type { EditorRunner } from "./useEditorRunner";
import { convertList } from "./keys/block-toggles";
import { clearSpans } from "./marks/span-commands";
import {
  BOLD,
  HIGHLIGHT,
  ITALIC,
  STRIKETHROUGH,
  toggleCodeSpan,
  toggleFormat,
} from "./keys/format-shortcut-plugin";
import { INSERT_BLOCK_EVENT } from "../utils/events";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Strings } from "../i18n/strings";
import {
  htmlTableItems,
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
// The editor commands behind the right-click, Format and Edit menus, and
// the right-click menu itself.

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
interface ContextMenuTarget {
  /** The image node's doc position, for the width items. */
  imagePos: number | null;
  /** Where the picture's file is, for Show in folder and Copy image path. */
  imageLocation: ImageLocation | null;
  /** The plugin's drawing right-clicked (a database, a chart), if any. */
  drawnBlock?: DrawnBlockActions | null;
  /** The link right-clicked, if any. */
  link?: MenuLink | null;
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
  const drawnBlock = drawnBlockActionsAt(e.target);
  if (drawnBlock) return { imagePos: null, imageLocation: null, drawnBlock };
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

      const link = menuLinkAt(view, e.target, docPath);
      if (link) return { ...none, link };
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
  /** From contextMenuTarget: the plugin's drawing right-clicked, if any. */
  drawnBlock?: DrawnBlockActions | null;
  /** From contextMenuTarget: the link right-clicked, if any. */
  link?: MenuLink | null;
  /** Already filtered down to the AI features that are switched on. */
  aiItems: ContextMenuItem[];
  /** Textus AI's items for the image right-clicked. */
  pictureAiItems?: ContextMenuItem[];
  copyOrCut: (cut: boolean) => void;
  /** Copy and paste as plain text, while Settings offers them. */
  copyAsPlainText?: () => void;
  paste: () => void;
  pasteAsPlainText?: () => void;
  selectAll: () => void;
  openFindReplace: () => void;
  openTableDialog: () => void;
  /** A note of the writer's own on the selection, offered while there is one. */
  addNote?: () => void;
  /** Accept or reject all of the writer's tracked changes, while there are some. */
  ownChanges?: { acceptAll: () => void; rejectAll: () => void };
}

export function buildContextMenuItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): ContextMenuEntry[] {
  const { t, imagePos } = options;
  const imageItems = joinGroups(
    imagePos === null ? [] : imageWidthItems(run, t, imagePos),
    imageFileItems(t, options.imageLocation ?? null),
    imagePos === null ? [] : imageTurnItems(run, t, imagePos),
    imagePos === null ? [] : (options.pictureAiItems ?? []),
  );
  const nothingSelected =
    run((ctx) => ctx.get(editorViewCtx).state.selection.empty) ?? true;
  const clipboard: ContextMenuEntry[] = [
    {
      label: t.cut,
      disabled: nothingSelected,
      onSelect: () => options.copyOrCut(true),
    },
    {
      label: t.copy,
      disabled: nothingSelected,
      onSelect: () => options.copyOrCut(false),
    },
    { label: t.paste, onSelect: options.paste },
    ...(options.copyAsPlainText && options.pasteAsPlainText
      ? [
          {
            label: t.menuPlainText,
            items: [
              {
                label: t.copyAsPlainText,
                disabled: nothingSelected,
                onSelect: options.copyAsPlainText,
              },
              {
                label: t.pasteAsPlainText,
                onSelect: options.pasteAsPlainText,
              },
            ],
          },
        ]
      : []),
    ...(options.addNote && !nothingSelected
      ? [{ label: t.ownNoteAdd, onSelect: options.addNote }]
      : []),
  ];
  const ownChanges: ContextMenuEntry[] = options.ownChanges
    ? [
        { label: t.trackAcceptAll, onSelect: options.ownChanges.acceptAll },
        { label: t.trackRejectAll, onSelect: options.ownChanges.rejectAll },
      ]
    : [];
  // What was clicked on comes first; the rest waits in submenus.
  const first = inTable(run)
    ? tableMenuItems(run, t)
    : joinGroups(
        options.link ? linkMenuItems(run, t, options.link) : [],
        htmlTableItems(run, t),
        imageItems,
        drawnBlockItems(t, options.drawnBlock ?? null),
      );
  const format = formatGroups(run, options, !inTable(run), nothingSelected);
  return joinGroups(
    first,
    clipboard,
    ownChanges,
    [...format, ...grouped(t.menuTextusAi, options.aiItems)],
    grouped(
      t.menuPlugins,
      contributedMenuItems({ selectedText: selectedText(run) }),
      2,
    ),
  );
}

/** A plugin's drawing: its source opened, or the whole block deleted. */
function drawnBlockItems(
  t: Strings,
  block: DrawnBlockActions | null,
): ContextMenuEntry[] {
  if (!block) return [];
  const layout = block.layout;
  return [
    { label: t.codeBlockEditSource, onSelect: block.editSource },
    ...(layout
      ? [
          {
            label: t.menuBlockWide,
            checked: layout.wide,
            onSelect: () => layout.set({ wide: !layout.wide }),
          },
          {
            label: t.menuBlockZoom,
            items: layout.zooms.map((zoom) => ({
              label: `${Math.round(zoom * 100)}%`,
              checked: zoom === layout.zoom,
              onSelect: () => layout.set({ zoom }),
            })),
          },
        ]
      : []),
    { label: t.codeBlockDelete, onSelect: block.remove },
  ];
}

/** Items as one submenu once there are more than `max`. */
function grouped(
  label: string,
  items: ContextMenuItem[],
  max = 1,
): ContextMenuEntry[] {
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
): ContextMenuEntry[] {
  const { t, imagePos } = options;
  // The phone has no Edit menu to offer the plain text.
  const clipboard: ContextMenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    ...(options.copyAsPlainText
      ? [{ label: t.copyAsPlainText, onSelect: options.copyAsPlainText }]
      : []),
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
function joinGroups(...groups: ContextMenuEntry[][]): ContextMenuEntry[] {
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
function generalItems(options: ContextMenuOptions): ContextMenuEntry[] {
  const { t, aiItems } = options;
  return [
    { label: t.selectAll, onSelect: options.selectAll },
    "separator",
    { label: t.findReplace, onSelect: options.openFindReplace },
    ...(aiItems.length > 0
      ? (["separator", ...aiItems] as ContextMenuEntry[])
      : []),
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

/** The inline styles, then (outside a table) the block the caret is in
 *  made a heading, list or quote, and blocks put in: Obsidian's Format,
 *  Paragraph and Insert. */
function formatGroups(
  run: EditorRunner,
  options: ContextMenuOptions,
  blocks: boolean,
  nothingSelected: boolean,
): ContextMenuEntry[] {
  const { t } = options;
  const onView = (act: (view: EditorView) => unknown) => () =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      act(view);
      view.focus();
    });
  // As the Format menu inserts them.
  const insertBlock = (kind: string) => () =>
    window.dispatchEvent(new CustomEvent(INSERT_BLOCK_EVENT, { detail: kind }));
  const format: ContextMenuEntry = {
    label: t.menuFormat,
    items: [
      { label: t.toolbarBold, onSelect: onView((v) => toggleFormat(v, BOLD)) },
      {
        label: t.toolbarItalic,
        onSelect: onView((v) => toggleFormat(v, ITALIC)),
      },
      {
        label: t.menuStrikethrough,
        onSelect: onView((v) => toggleFormat(v, STRIKETHROUGH)),
      },
      {
        label: t.toolbarHighlight,
        onSelect: onView((v) => toggleFormat(v, HIGHLIGHT)),
      },
      { label: t.menuInlineCode, onSelect: onView(toggleCodeSpan) },
      "separator",
      {
        label: t.menuClearFormatting,
        disabled: nothingSelected,
        onSelect: onView(clearSpans),
      },
    ],
  };
  if (!blocks) return [format];
  return [
    format,
    {
      label: t.menuParagraph,
      items: [
        ...[1, 2, 3].map((level) => ({
          label: fill(t.menuHeadingTemplate, { n: String(level) }),
          onSelect: () => insertHeading(run, level),
        })),
        "separator",
        {
          label: t.menuBulletList,
          onSelect: () => insertList(run, "bullet_list"),
        },
        {
          label: t.menuOrderedList,
          onSelect: () => insertList(run, "ordered_list"),
        },
        { label: t.menuTaskList, onSelect: insertBlock("task-list") },
        {
          label: t.menuBlockquote,
          onSelect: () => runCommand(run, wrapInBlockquoteCommand.key),
        },
      ],
    },
    {
      label: t.menuInsertGroup,
      items: [
        { label: t.menuTable, onSelect: options.openTableDialog },
        {
          label: t.menuCodeBlock,
          onSelect: () => runCommand(run, createCodeBlockCommand.key),
        },
        { label: t.menuMathBlock, onSelect: insertBlock("math-block") },
        { label: t.menuDivider, onSelect: insertBlock("rule") },
      ],
    },
  ];
}
