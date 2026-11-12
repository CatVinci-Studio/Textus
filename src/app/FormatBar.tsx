import { tabElement } from "../engine/layout/tab-element";
import { tabInUse } from "../engine/layout/store";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { caretBlock, NO_BLOCK, type CaretBlock } from "../editor/caret-block";
import { IconButton } from "../engine/controls/IconButton";
import { Tooltip } from "../engine/controls/Tooltip";
import { useFitItems } from "../engine/controls/fit-steps";
import { useMenuButton } from "../engine/controls/useMenuButton";
import type {
  ContextMenuEntry,
  ContextMenuItem,
} from "../engine/controls/ContextMenu";
import { fill } from "../i18n/fill";
import {
  BoldIcon,
  CodeBlockIcon,
  MoreIcon,
  HeadingIcon,
  HighlightIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  BulletListIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikeIcon,
  TableIcon,
} from "../engine/controls/icons";
import { formatCombo } from "../utils/shortcuts";
import {
  INSERT_BLOCK_EVENT,
  INSERT_LINK_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
} from "../utils/events";
import "./format-bar.css";

/**
 * The format bar (View › Format Bar): a row under the title bar with what the
 * Format menu does, for Markdown's own formats only. It sends the menu's
 * events, so the document on screen answers as it does to the menu, and
 * lights what is on at the caret.
 */
interface Button {
  label: (t: Strings) => string;
  keys?: string;
  Icon: ComponentType<{ className?: string }>;
  event: string;
  detail?: string;
  on?: (block: CaretBlock) => boolean;
  /** Opens a choice of levels rather than acting at once. */
  picksHeading?: true;
}

const GROUPS: Button[][] = [
  [
    {
      label: (t) => t.toolbarHeading,
      Icon: HeadingIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "heading",
      on: (b) => b.heading > 0,
      picksHeading: true,
    },
    {
      label: (t) => t.toolbarBold,
      keys: "mod+b",
      Icon: BoldIcon,
      event: TOGGLE_MARK_EVENT,
      detail: "bold",
      on: (b) => b.bold,
    },
    {
      label: (t) => t.toolbarItalic,
      keys: "mod+i",
      Icon: ItalicIcon,
      event: TOGGLE_MARK_EVENT,
      detail: "italic",
      on: (b) => b.italic,
    },
    {
      label: (t) => t.menuStrikethrough,
      keys: "ctrl+shift+`",
      Icon: StrikeIcon,
      event: TOGGLE_MARK_EVENT,
      detail: "strikethrough",
      on: (b) => b.strike,
    },
    {
      label: (t) => t.toolbarHighlight,
      keys: "mod+shift+h",
      Icon: HighlightIcon,
      event: TOGGLE_MARK_EVENT,
      detail: "highlight",
      on: (b) => b.highlight,
    },
    {
      label: (t) => t.menuInlineCode,
      keys: "ctrl+`",
      Icon: InlineCodeIcon,
      event: TOGGLE_MARK_EVENT,
      detail: "code",
      on: (b) => b.code,
    },
    {
      label: (t) => t.menuInsertLink,
      keys: "mod+k",
      Icon: LinkIcon,
      event: INSERT_LINK_EVENT,
    },
  ],
  [
    {
      label: (t) => t.menuBulletList,
      Icon: BulletListIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "bullet-list",
      on: (b) => b.bulletList,
    },
    {
      label: (t) => t.menuOrderedList,
      Icon: NumberedListIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "ordered-list",
      on: (b) => b.orderedList,
    },
    {
      label: (t) => t.menuBlockquote,
      Icon: QuoteIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "blockquote",
      on: (b) => b.quote,
    },
    {
      label: (t) => t.menuCodeBlock,
      Icon: CodeBlockIcon,
      event: INSERT_BLOCK_EVENT,
      detail: "code-block",
    },
    {
      label: (t) => t.menuTable,
      Icon: TableIcon,
      event: INSERT_BLOCK_EVENT,
      detail: "table",
      on: (b) => b.table,
    },
  ],
];

/** Every button, in the row's order: the ones folded into "⋯" go by it. */
const ALL: Button[] = GROUPS.flat();

/** The buttons `row` has folded away. */
function folded(row: HTMLElement | null): Button[] {
  if (!row) return [];
  return [
    ...row.querySelectorAll<HTMLElement>("[data-fit-hidden][data-fit-item]"),
  ].map((el) => ALL[Number(el.dataset.fitItem)]);
}

/** A button's press: its document first, then the menu's event. */
function press(tabId: string, b: Button) {
  focusDocument(tabId);
  window.dispatchEvent(new CustomEvent(b.event, { detail: b.detail }));
}

/** The heading picker: body text or a level, as Format's items set them,
 *  the caret's own ticked. */
function headingItems(
  t: Strings,
  tabId: string,
  level: number,
): ("separator" | ContextMenuItem)[] {
  const pick = (detail: string) => () => {
    focusDocument(tabId);
    window.dispatchEvent(new CustomEvent(INSERT_BLOCK_EVENT, { detail }));
  };
  return [
    {
      label: t.shortcutParagraph,
      checked: level === 0,
      onSelect: pick("paragraph"),
    },
    "separator",
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      label: fill(t.menuHeadingTemplate, { n: String(n) }),
      checked: level === n,
      onSelect: pick(`h${n}`),
    })),
  ];
}

/** What is on at the caret of one document, kept current: nothing while
 *  the caret is in another. */
function useCaretBlock(tabId: string): CaretBlock {
  const [block, setBlock] = useState<CaretBlock>(NO_BLOCK);
  useEffect(() => {
    let frame = 0;
    // The DOM settles after ProseMirror's update; read it a frame later.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setBlock(caretBlock(tabInUse() === tabId ? tabElement(tabId) : null)),
      );
    };
    read();
    document.addEventListener("selectionchange", read);
    document.addEventListener("input", read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("input", read);
    };
  }, [tabId]);
  return block;
}

/** Another island's bar: its document takes the keys first, at the
 *  selection it kept, so the format lands there. */
function focusDocument(tabId: string) {
  const editor = tabElement(tabId)?.querySelector<HTMLElement>(".ProseMirror");
  if (editor && !editor.contains(document.activeElement)) editor.focus();
}

export function FormatBar({
  t,
  tabId,
}: {
  t: Strings;
  /** The document it formats: a press brings it into use first (its
   *  island's pointerdown), so the menu's events reach it. */
  tabId: string;
}) {
  const block = useCaretBlock(tabId);
  // Narrower than its buttons, it keeps as many as fit and folds the rest,
  // from the end, into "⋯".
  const row = useRef<HTMLDivElement>(null);
  useFitItems(row, ".format-bar-more");
  const headings = () => headingItems(t, tabId, block.heading);
  const heading = useMenuButton(headings, { title: t.toolbarHeading });
  const more = useMenuButton(
    () =>
      folded(row.current).map((b): ContextMenuEntry =>
        b.picksHeading
          ? { label: b.label(t), items: headings() }
          : { label: b.label(t), onSelect: () => press(tabId, b) },
      ),
    { alignEnd: true },
  );
  return (
    <div
      className="format-bar"
      role="toolbar"
      aria-label={t.toolbarLabel}
      // A press leaves the caret where it was, in the document.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={row} className="format-bar-row">
        {GROUPS.map((group, g) => (
          <div key={g} className="format-bar-group">
            {group.map((b) => {
              const label = b.label(t);
              return (
                <span
                  key={label}
                  className="format-bar-item"
                  data-fit-item={ALL.indexOf(b)}
                >
                  {b.picksHeading ? (
                    <Tooltip text={label}>
                      <button
                        type="button"
                        className="tx-icon-button"
                        aria-label={label}
                        aria-pressed={b.on?.(block)}
                        {...heading.button}
                      >
                        <b.Icon />
                      </button>
                    </Tooltip>
                  ) : (
                    <IconButton
                      label={label}
                      hint={b.keys ? `${label}  ${formatCombo(b.keys)}` : label}
                      pressed={b.on ? b.on(block) : undefined}
                      onClick={() => press(tabId, b)}
                    >
                      <b.Icon />
                    </IconButton>
                  )}
                </span>
              );
            })}
          </div>
        ))}
        <Tooltip text={t.toolbarMore}>
          <button
            type="button"
            className="tx-icon-button format-bar-more"
            aria-label={t.toolbarMore}
            {...more.button}
          >
            <MoreIcon />
          </button>
        </Tooltip>
      </div>
      {heading.menu}
      {more.menu}
    </div>
  );
}
