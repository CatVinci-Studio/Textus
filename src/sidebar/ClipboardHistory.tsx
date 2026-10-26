import { useSettings } from "../settings/SettingsContext";
import { CopyIcon } from "../ui/icons";
import {
  useClipboardHistory,
  clearClipboardHistory,
  recordClipboardEntry,
} from "../clipboard/history";
import { INSERT_CLIPBOARD_TEXT_EVENT } from "../utils/events";
import { Tooltip } from "../ui/Tooltip";

const PREVIEW_MAX_CHARS = 120;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX_CHARS
    ? `${flat.slice(0, PREVIEW_MAX_CHARS)}…`
    : flat;
}

/**
 * Sidebar panel over the clipboard history: a click inserts an entry at the
 * cursor, the copy button puts it back on the system clipboard.
 */
export function ClipboardHistory() {
  const { t } = useSettings();
  const entries = useClipboardHistory();

  if (entries.length === 0) {
    return <div className="clipboard-empty">{t.clipboardEmpty}</div>;
  }

  return (
    <div className="clipboard-history">
      <div className="clipboard-toolbar">
        <button className="clipboard-clear" onClick={clearClipboardHistory}>
          {t.clipboardClear}
        </button>
      </div>
      {entries.map((entry) => (
        <div
          key={entry.at}
          className="clipboard-entry"
          title={t.clipboardInsertHint}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(INSERT_CLIPBOARD_TEXT_EVENT, {
                detail: entry.text,
              }),
            )
          }
        >
          <span className="clipboard-entry-text">{preview(entry.text)}</span>
          <Tooltip text={t.clipboardCopy}>
            <button
              className="clipboard-entry-copy"
              aria-label={t.clipboardCopy}
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(entry.text);
                recordClipboardEntry(entry.text);
              }}
            >
              <CopyIcon />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
