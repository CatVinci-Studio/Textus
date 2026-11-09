import { useEffect, useState, type ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { caretBlock, NO_BLOCK, type CaretBlock } from "../editor/caret-block";
import { IconButton } from "../ui/IconButton";
import {
  BoldIcon,
  CodeBlockIcon,
  HeadingIcon,
  HighlightIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  OrderedListIcon,
  QuoteIcon,
  StrikeIcon,
  TableIcon,
} from "../ui/format-icons";
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
}

const GROUPS: Button[][] = [
  [
    {
      label: (t) => t.toolbarHeading,
      Icon: HeadingIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "heading",
      on: (b) => b.heading > 0,
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
      Icon: ListIcon,
      event: TOGGLE_BLOCK_EVENT,
      detail: "bullet-list",
      on: (b) => b.bulletList,
    },
    {
      label: (t) => t.menuOrderedList,
      Icon: OrderedListIcon,
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

const ACTIVE_TAB = '.main-pane [data-active-tab="true"]';

/** What is on at the caret of the document on screen, kept current. */
function useCaretBlock(): CaretBlock {
  const [block, setBlock] = useState<CaretBlock>(NO_BLOCK);
  useEffect(() => {
    let frame = 0;
    // The DOM settles after ProseMirror's update; read it a frame later.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setBlock(caretBlock(document.querySelector(ACTIVE_TAB))),
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
  }, []);
  return block;
}

export function FormatBar({ t }: { t: Strings }) {
  const block = useCaretBlock();
  return (
    <div
      className="format-bar"
      role="toolbar"
      aria-label={t.toolbarLabel}
      // A press leaves the caret where it was, in the document.
      onMouseDown={(e) => e.preventDefault()}
    >
      {GROUPS.map((group, g) => (
        <div key={g} className="format-bar-group">
          {group.map((b) => {
            const label = b.label(t);
            return (
              <IconButton
                key={label}
                label={label}
                hint={b.keys ? `${label}  ${formatCombo(b.keys)}` : label}
                pressed={b.on ? b.on(block) : undefined}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(b.event, { detail: b.detail }),
                  )
                }
              >
                <b.Icon />
              </IconButton>
            );
          })}
        </div>
      ))}
    </div>
  );
}
