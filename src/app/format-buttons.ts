import type { ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import type { CaretBlock } from "../editor/caret-block";
import {
  BoldIcon,
  CodeBlockIcon,
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
import {
  INSERT_BLOCK_EVENT,
  INSERT_LINK_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
} from "../utils/events";

/** A format bar button: the menu event it sends, and whether it is on at
 *  the caret. */
export interface Button {
  label: (t: Strings) => string;
  keys?: string;
  /** Drawn as an icon, or as short words (an image's width). */
  Icon?: ComponentType<{ className?: string }>;
  text?: (t: Strings) => string;
  event: string;
  detail?: string;
  on?: (block: CaretBlock) => boolean;
  /** Opens a choice of levels rather than acting at once. */
  picksHeading?: true;
}

export const GROUPS: Button[][] = [
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
