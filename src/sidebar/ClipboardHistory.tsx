import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import {
  CheckIcon,
  ClipboardTabIcon,
  CloseIcon,
  CopyIcon,
} from "../ui/icons";
import {
  useClipboardHistory,
  clearClipboardHistory,
  recordClipboardEntry,
  removeClipboardEntry,
  type ClipboardEntry,
} from "../clipboard/history";
import { INSERT_CLIPBOARD_TEXT_EVENT } from "../utils/events";

const PREVIEW_MAX_CHARS = 140;

/** What an entry reads as at a glance: the words, without the markdown
 *  markers around them (the inserted text keeps them). */
export function preview(text: string): string {
  const flat = text
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > PREVIEW_MAX_CHARS
    ? `${flat.slice(0, PREVIEW_MAX_CHARS)}…`
    : flat;
}

/** A tag for entries that are not plain prose. */
function kindOf(text: string): "code" | "math" | null {
  const t = text.trim();
  if (/^```|^ {4}\S/m.test(t)) return "code";
  if (/^\$\$|^\\(begin|sub|section|input|frac|[a-z]+\{)/.test(t)) return "math";
  return null;
}

/** "3 分钟前", "yesterday": in the UI's language, no strings of our own. */
function relativeTime(at: number, now: number, lang: string): string {
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const seconds = Math.round((at - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size)
      return unit === "second" && Math.abs(value) < 45
        ? format.format(0, "second")
        : format.format(Math.round(value), unit);
    value /= size;
  }
  return "";
}

/**
 * Sidebar panel over the rolling clipboard history (see
 * clipboard/history.ts for what gets recorded): one soft card per entry,
 * newest first, with when it was copied. Clicking a card inserts it at the
 * cursor like a paste; on hover, copy puts it back on the system clipboard
 * and × forgets it.
 */
export function ClipboardHistory() {
  const { t, settings } = useSettings();
  const entries = useClipboardHistory();
  // Re-read "x minutes ago" now and then while the panel is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="clipboard-empty">
        <ClipboardTabIcon />
        <p>{t.clipboardEmpty}</p>
      </div>
    );
  }

  return (
    <div className="clipboard-history">
      <div className="clipboard-toolbar">
        <span className="clipboard-title">{t.clipboardTab}</span>
        <span className="clipboard-count">{entries.length}</span>
        <button className="clipboard-clear" onClick={clearClipboardHistory}>
          {t.clipboardClear}
        </button>
      </div>
      <div className="clipboard-list">
        {entries.map((entry) => (
          <ClipboardCard
            key={entry.text}
            entry={entry}
            when={relativeTime(entry.at, now, settings.language)}
            labels={{
              insert: t.clipboardInsertHint,
              copy: t.clipboardCopy,
              remove: t.docDelete,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ClipboardCard({
  entry,
  when,
  labels,
}: {
  entry: ClipboardEntry;
  when: string;
  labels: { insert: string; copy: string; remove: string };
}) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const flash = (set: (on: boolean) => void) => {
    set(true);
    timers.current.push(setTimeout(() => set(false), 900));
  };
  const kind = kindOf(entry.text);
  const insert = () => {
    window.dispatchEvent(
      new CustomEvent(INSERT_CLIPBOARD_TEXT_EVENT, { detail: entry.text }),
    );
    flash(setInserted);
  };
  return (
    <div
      className={`clipboard-entry${inserted ? " is-inserted" : ""}`}
      role="button"
      tabIndex={0}
      title={labels.insert}
      onClick={insert}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          insert();
        }
      }}
    >
      <span
        className={`clipboard-entry-text${kind ? ` is-${kind}` : ""}`}
      >
        {preview(entry.text)}
      </span>
      <span className="clipboard-entry-meta">
        {kind && (
          <span className="clipboard-entry-kind">
            {kind === "code" ? "Code" : "TeX"}
          </span>
        )}
        <span>{when}</span>
      </span>
      <span className="clipboard-entry-actions">
        <button
          className="clipboard-entry-action"
          title={labels.copy}
          aria-label={labels.copy}
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(entry.text);
            recordClipboardEntry(entry.text);
            flash(setCopied);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          className="clipboard-entry-action"
          title={labels.remove}
          aria-label={labels.remove}
          onClick={(e) => {
            e.stopPropagation();
            removeClipboardEntry(entry.text);
          }}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}
