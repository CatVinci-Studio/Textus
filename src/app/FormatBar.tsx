import { useScrollFade } from "../engine/controls/scroll-fade";
import { tabElement } from "../engine/layout/tab-element";
import { tabInUse } from "../engine/layout/store";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { caretBlock, NO_BLOCK, type CaretBlock } from "../editor/caret-block";
import { IconButton } from "../engine/controls/IconButton";
import { Tooltip } from "../engine/controls/Tooltip";
import { useFitSteps } from "../engine/controls/fit-steps";
import { useMenuButton } from "../engine/controls/useMenuButton";
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
  /** Rarely used: among the first to fold into "⋯" in a narrow island. */
  rare?: boolean;
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
      rare: true,
      detail: "strikethrough",
      on: (b) => b.strike,
    },
    {
      label: (t) => t.toolbarHighlight,
      keys: "mod+shift+h",
      Icon: HighlightIcon,
      event: TOGGLE_MARK_EVENT,
      rare: true,
      detail: "highlight",
      on: (b) => b.highlight,
    },
    {
      label: (t) => t.menuInlineCode,
      keys: "ctrl+`",
      Icon: InlineCodeIcon,
      event: TOGGLE_MARK_EVENT,
      rare: true,
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

/** Narrower than its buttons: tighter, then the blocks fold into "⋯",
 *  then the rare marks join them; past that the row scrolls. */
const FIT = ["tight", "blocks", "rare"] as const;

/** The buttons folded into "⋯" at the row's present step. */
function folded(step: string | undefined): Button[] {
  if (step !== "blocks" && step !== "rare") return [];
  const rare = step === "rare" ? GROUPS[0].filter((b) => b.rare) : [];
  return [...rare, ...GROUPS[1]];
}

/** A button's press: its document first, then the menu's event. */
function press(tabId: string, b: Button) {
  focusDocument(tabId);
  window.dispatchEvent(new CustomEvent(b.event, { detail: b.detail }));
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
  // Narrower than its buttons, it gives way (FIT), and at last scrolls, its
  // edge fading where more are.
  const row = useRef<HTMLDivElement>(null);
  useFitSteps(row, FIT);
  useScrollFade(row, "x");
  const more = useMenuButton(
    () =>
      folded(row.current?.dataset.fit).map((b) => ({
        label: b.label(t),
        onSelect: () => press(tabId, b),
      })),
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
      <div ref={row} className="format-bar-row tx-scroll-fade">
        {GROUPS.map((group, g) => (
          <div key={g} className="format-bar-group">
            {group.map((b) => {
              const label = b.label(t);
              return (
                <span
                  key={label}
                  className="format-bar-item"
                  data-rare={b.rare || undefined}
                >
                  <IconButton
                    label={label}
                    hint={b.keys ? `${label}  ${formatCombo(b.keys)}` : label}
                    pressed={b.on ? b.on(block) : undefined}
                    onClick={() => press(tabId, b)}
                  >
                    <b.Icon />
                  </IconButton>
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
      {more.menu}
    </div>
  );
}
