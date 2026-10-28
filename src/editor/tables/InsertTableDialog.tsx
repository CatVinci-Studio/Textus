import { useState } from "react";
import { useModalDialog } from "../../ui/useModalDialog";
import { usePresenceProps } from "../../ui/usePresence";
import "./InsertTableDialog.css";
import { isImeKeydown } from "../../utils/ime";

interface InsertTableDialogProps {
  title: string;
  rowsLabel: string;
  columnsLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onInsert: (rows: number, cols: number) => void;
  onClose: () => void;
}

export function InsertTableDialog({
  title,
  rowsLabel,
  columnsLabel,
  confirmLabel,
  cancelLabel,
  onInsert,
  onClose,
}: InsertTableDialogProps) {
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");

  const modal = useModalDialog(onClose);
  const presence = usePresenceProps<HTMLDivElement>();
  const rowCount = Number(rows);
  const columnCount = Number(cols);
  const validRows =
    Number.isInteger(rowCount) && rowCount >= 1 && rowCount <= 50;
  const validColumns =
    Number.isInteger(columnCount) && columnCount >= 1 && columnCount <= 20;
  const valid = validRows && validColumns;

  function submit() {
    if (!valid) return;
    onInsert(rowCount, columnCount);
    onClose();
  }

  return (
    <div {...presence} className="insert-table-overlay" onClick={onClose}>
      <div
        {...modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="insert-table-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          modal.onKeyDown(e);
          if (isImeKeydown(e)) return;
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="insert-table-title">{title}</div>
        <div className="insert-table-fields">
          <label>
            {rowsLabel}
            <input
              type="number"
              min={1}
              max={50}
              value={rows}
              step={1}
              aria-invalid={!validRows}
              onChange={(e) => setRows(e.target.value)}
            />
          </label>
          <label>
            {columnsLabel}
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              step={1}
              aria-invalid={!validColumns}
              onChange={(e) => setCols(e.target.value)}
            />
          </label>
        </div>
        <div className="insert-table-buttons">
          <div className="insert-table-spacer" />
          <button onClick={onClose}>{cancelLabel}</button>
          <button
            className="insert-table-primary"
            disabled={!valid}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
