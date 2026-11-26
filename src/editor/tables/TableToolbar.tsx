import { useCallback, useRef, useState, type RefObject } from "react";
import { useFitSteps } from "../../engine/controls/fit-steps";
import { createRoot, type Root } from "react-dom/client";
import type { Strings } from "../../i18n/strings";
import { fill } from "../../i18n/fill";
import { TABLE_TOOL_ICONS as ICONS } from "../../engine/controls/icons";
import { Bubble } from "../../engine/controls/Bubble";
import { Sheet } from "../../engine/controls/Sheet";
import { SizeGrid, type GridSize } from "../../engine/controls/SizeGrid";
import { isPhoneLayout } from "../../platform/phone-layout";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import type { Alignment } from "./table-edits";
import { COPIED_MS } from "../widget-button";

const ALIGNS = ["left", "center", "right"] as const;

interface TableToolbarProps {
  t: Strings;
  rows: number;
  cols: number;
  /** Whether the cell at row `r`, column `c` has text. */
  filled: (r: number, c: number) => boolean;
  /** The caret's columns' shared alignment; undefined with no caret in
   *  the table, when the buttons have nothing to act on. */
  align: Alignment | null | undefined;
  editable: boolean;
  onAlign: (alignment: Alignment) => void;
  onSize: (rows: number, cols: number) => void;
  onCopy: () => Promise<unknown> | void;
  onDelete: () => void;
  /** The size grid open or shut: the tools stay shown while it is. */
  onOpenChange: (open: boolean) => void;
}

/** Short of room over a narrow table, the tools give way in turn: tighter
 *  pills, then Copy, then the alignments (both in its right-click menu). */
const FIT_STEPS = ["tight", "no-copy", "no-align"] as const;

/** A table's tools over its top right, as a code block's pills: its size,
 *  its columns' alignment, Copy and Delete. */
function TableToolbar(p: TableToolbarProps & { bar: RefObject<HTMLElement> }) {
  const { t } = p;
  useFitSteps(p.bar, FIT_STEPS);
  const sizeSlot = useRef<HTMLSpanElement>(null);
  const [sizing, setSizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const openChange = useRef(p.onOpenChange);
  openChange.current = p.onOpenChange;
  // One function for the grid's life: its outside-click watch stays put.
  const show = useCallback((open: boolean) => {
    setSizing(open);
    openChange.current(open);
  }, []);
  const close = useCallback(() => show(false), [show]);
  const size = `${p.rows} × ${p.cols}`;
  const copy = () =>
    void Promise.resolve(p.onCopy()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return (
    <>
      {p.editable && (
        <span ref={sizeSlot} className="block-toolbar-slot">
          <button
            type="button"
            className="block-pill table-size-pill"
            aria-label={`${t.tableSize} ${size}`}
            aria-haspopup="dialog"
            aria-expanded={sizing}
            onClick={() => show(!sizing)}
          >
            {size}
            <ICONS.chevron />
          </button>
        </span>
      )}
      {p.editable && (
        <span className="block-pill table-align-pill" role="group">
          {ALIGNS.map((a) => {
            const Icon = ICONS[a];
            const label =
              a === "left"
                ? t.alignLeft
                : a === "center"
                  ? t.alignCenter
                  : t.alignRight;
            return (
              <button
                key={a}
                type="button"
                aria-label={label}
                aria-pressed={p.align === a}
                disabled={p.align === undefined}
                onClick={() => p.onAlign(a)}
              >
                <Icon />
              </button>
            );
          })}
        </span>
      )}
      <button
        type="button"
        className={`block-pill table-copy-pill${copied ? " is-copied" : ""}`}
        onClick={copy}
      >
        {copied ? t.codeBlockCopied : t.copy}
      </button>
      {p.editable && (
        <button
          type="button"
          className="block-pill block-pill-icon is-danger"
          aria-label={t.deleteTable}
          onClick={p.onDelete}
        >
          <ICONS.delete />
        </button>
      )}
      {sizing && sizeSlot.current && (
        <SizePicker {...p} anchor={sizeSlot.current} onClose={close} />
      )}
    </>
  );
}

/** The size grid, under its pill; on a phone, a sheet. */
function SizePicker({
  t,
  rows,
  cols,
  filled,
  onSize,
  anchor,
  onClose,
}: TableToolbarProps & { anchor: HTMLElement; onClose: () => void }) {
  // One ref for the grid's life: a new one each render places it again.
  const anchorRef = useRef(anchor);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    onClose,
    true,
    true,
    anchor,
  );
  const phone = isPhoneLayout();
  const body = (
    <div ref={ref} className="table-size-body">
      <SizeGrid
        value={{ rows, cols }}
        least={{ rows: 2, cols: 1 }}
        most={phone ? { rows: 12, cols: 8 } : { rows: 20, cols: 12 }}
        label={t.tableSize}
        sizeText={(s: GridSize) => fill(t.tableGridSize, { ...s })}
        filled={filled}
        losesText={t.tableGridLoses}
        onPick={(s) => {
          onSize(s.rows, s.cols);
          onClose();
        }}
      />
    </div>
  );
  if (phone)
    return (
      <Sheet
        label={t.tableSize}
        className="bottom-card table-size-sheet"
        onClose={onClose}
      >
        {body}
      </Sheet>
    );
  return (
    <Bubble
      anchor={anchorRef}
      role="dialog"
      aria-label={t.tableSize}
      className="table-size-card floating-surface"
      align="start"
      gap={6}
    >
      {body}
    </Bubble>
  );
}

/** The table view's tools, drawn into `container` outside React's tree. */
export function mountTableToolbar(container: HTMLElement) {
  let root: Root | null = createRoot(container);
  const bar = { current: container };
  return {
    render(props: TableToolbarProps) {
      root?.render(<TableToolbar {...props} bar={bar} />);
    },
    destroy() {
      const done = root;
      root = null;
      // Not during a render ProseMirror's redraw may be inside.
      queueMicrotask(() => done?.unmount());
    },
  };
}
