import type { CaretBlock } from "../editor/caret-block";
import type { TableAction } from "../editor/editor-menu-tables";
import type { Strings } from "../i18n/strings";
import { TableEditIcon, TrashIcon, UndoIcon } from "../engine/controls/icons";
import {
  EDIT_ACTION_EVENT,
  IMAGE_ACTION_EVENT,
  TABLE_ACTION_EVENT,
} from "../utils/events";
import { GROUPS, type Button } from "./format-buttons";

/*
 * The format bar on a phone (design: phone, typing): undo first, as a phone
 * has no ⌘Z, and in a table or on an image that block's own buttons in place
 * of the text formats, none of which apply there.
 */

const UNDO: Button = {
  label: (t) => t.menuUndo,
  Icon: UndoIcon,
  event: EDIT_ACTION_EVENT,
  detail: "undo",
};

const IMAGE_WIDTHS = [30, 50, 70, 100] as const;

function tableButton(
  action: TableAction,
  label: (t: Strings) => string,
): Button {
  return {
    label,
    Icon: (props) => <TableEditIcon kind={action} {...props} />,
    event: TABLE_ACTION_EVENT,
    detail: action,
  };
}

const TABLE: Button[][] = [
  [
    tableButton("row-below", (t) => t.insertRowBelow),
    tableButton("row-above", (t) => t.insertRowAbove),
    tableButton("column-right", (t) => t.insertColumnRight),
    tableButton("column-left", (t) => t.insertColumnLeft),
  ],
  [
    tableButton("delete-row", (t) => t.deleteRow),
    tableButton("delete-column", (t) => t.deleteColumn),
    tableButton("delete-table", (t) => t.deleteTable),
  ],
];

const IMAGE: Button[][] = [
  [
    {
      label: (t) => t.imageWidthAuto,
      text: (t) => t.imageWidthShortAuto,
      event: IMAGE_ACTION_EVENT,
      detail: "width:auto",
      on: (b) => b.image?.width === null,
    },
    ...IMAGE_WIDTHS.map((percent): Button => ({
      label: (t) => t[`imageWidth${percent}`],
      text: () => `${percent}%`,
      event: IMAGE_ACTION_EVENT,
      detail: `width:${percent}`,
      on: (b) => b.image?.width === `${percent}%`,
    })),
  ],
  [
    {
      label: (t) => t.deleteImage,
      Icon: TrashIcon,
      event: IMAGE_ACTION_EVENT,
      detail: "delete",
    },
  ],
];

/** The phone's groups for where the caret is. */
export function phoneGroups(block: CaretBlock): Button[][] {
  const context = block.image ? IMAGE : block.table ? TABLE : GROUPS;
  return [[UNDO], ...context];
}
