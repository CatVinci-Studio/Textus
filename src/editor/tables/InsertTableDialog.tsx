import { useModalDialog } from "../../engine/controls/useModalDialog";
import { usePresenceProps } from "../../engine/motion/usePresence";
import { SizeGrid } from "../../engine/controls/SizeGrid";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import "./InsertTableDialog.css";
import { DialogActions } from "../../engine/controls/DialogActions";

interface InsertTableDialogProps {
  t: Strings;
  onInsert: (rows: number, cols: number) => void;
  onClose: () => void;
}

/** A new table's size, picked on the grid the table's own tools use. */
export function InsertTableDialog({
  t,
  onInsert,
  onClose,
}: InsertTableDialogProps) {
  // Its caret is the new table's first cell (insertTable), not the one it
  // was opened from: on a phone no caret is put back.
  const modal = useModalDialog(onClose, true, undefined, false);
  const presence = usePresenceProps<HTMLDivElement>();
  return (
    <div
      {...presence}
      className="tx-backdrop insert-table-overlay"
      onClick={onClose}
    >
      <div
        {...modal}
        role="dialog"
        aria-modal="true"
        aria-label={t.insertTable}
        className="close-prompt insert-table-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="insert-table-title">{t.insertTable}</div>
        <SizeGrid
          value={{ rows: 3, cols: 3 }}
          least={{ rows: 2, cols: 1 }}
          most={{ rows: 20, cols: 12 }}
          label={t.insertTable}
          sizeText={(s) => fill(t.tableGridSize, { ...s })}
          onPick={(s) => {
            onInsert(s.rows, s.cols);
            onClose();
          }}
        />
        <DialogActions className="insert-table-buttons">
          <button className="tx-button" onClick={onClose}>
            {t.cancel}
          </button>
        </DialogActions>
      </div>
    </div>
  );
}
