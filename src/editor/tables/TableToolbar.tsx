import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Strings } from "../../i18n/strings";
import {
  TABLE_TOOL_ICONS as ICONS,
  TableEditIcon,
} from "../../engine/controls/icons";
import { IconButton } from "../../engine/controls/IconButton";
import { Bubble } from "../../engine/controls/Bubble";
import { Sheet } from "../../engine/controls/Sheet";
import { isPhoneLayout } from "../../platform/phone-layout";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import type { Alignment } from "./table-edits";

const {
  size: SizeIcon,
  copy: CopyIcon,
  less: LessIcon,
  more: MoreIcon,
} = ICONS;
const ALIGNS = ["left", "center", "right"] as const;

interface TableToolbarProps {
  t: Strings;
  rows: number;
  cols: number;
  /** The caret's columns' shared alignment; undefined with no caret in
   *  the table, when the buttons have nothing to act on. */
  align: Alignment | null | undefined;
  editable: boolean;
  onAlign: (alignment: Alignment) => void;
  onSize: (rows: number, cols: number) => void;
  onCopy: () => void;
  onDelete: () => void;
  /** The size card open or shut: the tools stay shown while it is. */
  onOpenChange: (open: boolean) => void;
}

/** A table's tools at its top right, as a code block's: its columns'
 *  alignment, its size, Copy and Delete. */
function TableToolbar(p: TableToolbarProps) {
  const { t } = p;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [sizing, setSizing] = useState(false);
  const show = (open: boolean) => {
    setSizing(open);
    p.onOpenChange(open);
  };
  const button = "block-toolbar-button";
  return (
    <>
      {p.editable &&
        ALIGNS.map((a) => {
          const Icon = ICONS[a];
          const label =
            a === "left"
              ? t.alignLeft
              : a === "center"
                ? t.alignCenter
                : t.alignRight;
          return (
            <IconButton
              key={a}
              className={button}
              label={label}
              pressed={p.align === a}
              disabled={p.align === undefined}
              onClick={() => p.onAlign(a)}
            >
              <Icon />
            </IconButton>
          );
        })}
      {p.editable && (
        <span ref={(el) => setAnchor(el?.querySelector("button") ?? null)}>
          <IconButton
            className={button}
            label={t.tableSize}
            pressed={sizing}
            onClick={() => show(!sizing)}
          >
            <SizeIcon />
          </IconButton>
        </span>
      )}
      <IconButton className={button} label={t.copyTable} onClick={p.onCopy}>
        <CopyIcon />
      </IconButton>
      {p.editable && (
        <IconButton
          className={`${button} is-danger`}
          label={t.deleteTable}
          onClick={p.onDelete}
        >
          <TableEditIcon kind="delete-table" />
        </IconButton>
      )}
      {sizing && anchor && (
        <SizeCard {...p} anchor={anchor} onClose={() => show(false)} />
      )}
    </>
  );
}

/** Rows and columns, each one more or one fewer at the table's end: a card
 *  under its button, on a phone a sheet. */
function SizeCard({
  t,
  rows,
  cols,
  onSize,
  anchor,
  onClose,
}: TableToolbarProps & { anchor: HTMLElement; onClose: () => void }) {
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    onClose,
    true,
    true,
    anchor,
  );
  const body = (
    <div ref={ref} className="table-size-card-body">
      <Stepper
        label={t.insertTableRowsLabel}
        value={rows}
        least={2}
        less={t.tableFewerRows}
        more={t.tableMoreRows}
        onChange={(n) => onSize(n, cols)}
      />
      <Stepper
        label={t.insertTableColumnsLabel}
        value={cols}
        least={1}
        less={t.tableFewerColumns}
        more={t.tableMoreColumns}
        onChange={(n) => onSize(rows, n)}
      />
    </div>
  );
  if (isPhoneLayout())
    return (
      <Sheet
        role="dialog"
        label={t.tableSize}
        className="bottom-card table-size-sheet"
        onClose={onClose}
      >
        {body}
      </Sheet>
    );
  return (
    <Bubble
      anchor={{ current: anchor }}
      role="dialog"
      aria-label={t.tableSize}
      className="table-size-card floating-surface"
      gap={6}
    >
      {body}
    </Bubble>
  );
}

function Stepper({
  label,
  value,
  least,
  less,
  more,
  onChange,
}: {
  label: string;
  value: number;
  least: number;
  less: string;
  more: string;
  onChange: (n: number) => void;
}): ReactNode {
  return (
    <div className="table-size-row" role="group" aria-label={label}>
      <span className="table-size-label">{label}</span>
      <IconButton
        className="tx-icon-button"
        label={less}
        disabled={value <= least}
        onClick={() => onChange(value - 1)}
      >
        <LessIcon />
      </IconButton>
      <span className="table-size-value" aria-live="polite">
        {value}
      </span>
      <IconButton
        className="tx-icon-button"
        label={more}
        onClick={() => onChange(value + 1)}
      >
        <MoreIcon />
      </IconButton>
    </div>
  );
}

/** The table view's tools, drawn into `container` outside React's tree. */
export function mountTableToolbar(container: HTMLElement) {
  let root: Root | null = createRoot(container);
  return {
    render(props: TableToolbarProps) {
      root?.render(<TableToolbar {...props} />);
    },
    destroy() {
      const done = root;
      root = null;
      // Not during a render ProseMirror's redraw may be inside.
      queueMicrotask(() => done?.unmount());
    },
  };
}
