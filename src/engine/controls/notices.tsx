import { useEffect, useState, type CSSProperties } from "react";
import "./notices.css";

/** Short notes at the bottom of the window that go by themselves, and
 *  progress bars for slow work: what a plugin says without stopping the user.
 *  Shown by the one NoticeHost App mounts. */

interface Notice {
  id: number;
  text: string;
  tone: "info" | "warning" | "error";
  /** Who says it (a plugin's name), before the text. */
  source?: string;
  /** A progress bar: 0 to 1, or null while it can't tell. */
  progress?: { fraction: number | null; message?: string };
  cancelLabel?: string;
  onCancel?: () => void;
  /** A button that does what the note suggests, and closes it. */
  action?: { label: string; run: () => void };
  /** Called once it has gone, acted on or not. */
  onGone?: () => void;
}

/** How long a note stays: long enough to read a line, or to act on one. */
const NOTICE_MS = 4500;
const ACTION_NOTICE_MS = 12000;
/** At most this many at once; an older one gives way. */
const MAX_SHOWN = 3;

let nextId = 1;
let notices: Notice[] = [];
const listeners = new Set<(notices: Notice[]) => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function publish() {
  for (const listener of listeners) listener(notices);
}

function remove(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  notices.find((n) => n.id === id)?.onGone?.();
  notices = notices.filter((n) => n.id !== id);
  publish();
}

/** Removes a note after `ms`; a pointer resting on it holds it (hold). */
function arm(id: number, ms: number) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => remove(id), ms),
  );
}

function hold(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** What a note has left once the pointer moves off it. */
const AFTER_HOLD_MS = 1500;

function add(notice: Omit<Notice, "id">): number {
  // Said again while showing: the one note stays, its time starts over.
  const same = notices.find(
    (n) =>
      !n.progress &&
      !notice.progress &&
      n.text === notice.text &&
      n.source === notice.source,
  );
  if (same) return same.id;
  const id = nextId++;
  notices = [...notices, { ...notice, id }];
  // The oldest note that isn't a progress bar makes room.
  while (notices.length > MAX_SHOWN) {
    const old = notices.find((n) => !n.progress);
    if (!old) break;
    remove(old.id);
  }
  publish();
  return id;
}

export function showNotice(
  text: string,
  options: {
    tone?: Notice["tone"];
    source?: string;
    action?: Notice["action"];
    onGone?: () => void;
  } = {},
): void {
  const { action } = options;
  const id = add({
    text,
    tone: options.tone ?? "info",
    source: options.source,
    action: action && {
      label: action.label,
      // Acted on first, then gone: a caller hears which.
      run: () => {
        action.run();
        remove(id);
      },
    },
    onGone: options.onGone,
  });
  arm(id, action ? ACTION_NOTICE_MS : NOTICE_MS);
}

/** A progress bar that stays until endProgress; `onCancel` adds a way to
 *  stop the work. */
export function startProgress(
  title: string,
  options: {
    source?: string;
    cancelLabel?: string;
    onCancel?: () => void;
  } = {},
): number {
  return add({
    text: title,
    tone: "info",
    source: options.source,
    progress: { fraction: null },
    cancelLabel: options.cancelLabel,
    onCancel: options.onCancel,
  });
}

export function reportProgress(
  id: number,
  report: { fraction?: number; message?: string },
): void {
  notices = notices.map((n) =>
    n.id === id && n.progress
      ? {
          ...n,
          progress: {
            fraction:
              report.fraction === undefined
                ? n.progress.fraction
                : Math.min(1, Math.max(0, report.fraction)),
            message: report.message ?? n.progress.message,
          },
        }
      : n,
  );
  publish();
}

export function endProgress(id: number): void {
  remove(id);
}

/** Mounted once per window, by App. */
export function NoticeHost() {
  const [shown, setShown] = useState<Notice[]>(notices);
  useEffect(() => {
    listeners.add(setShown);
    return () => {
      listeners.delete(setShown);
    };
  }, []);
  if (!shown.length) return null;
  return (
    <div className="notice-stack" role="status" aria-live="polite">
      {shown.map((notice) => (
        <div
          key={notice.id}
          className="notice floating-surface"
          data-tone={notice.tone}
          onMouseEnter={notice.progress ? undefined : () => hold(notice.id)}
          onMouseLeave={
            notice.progress ? undefined : () => arm(notice.id, AFTER_HOLD_MS)
          }
        >
          <div className="notice-text">
            {notice.source && (
              <span className="notice-source">{notice.source}</span>
            )}
            <span>{notice.text}</span>
            {notice.progress?.message && (
              <span className="notice-detail">{notice.progress.message}</span>
            )}
          </div>
          {notice.progress && (
            <div
              className={`tx-progress notice-bar${notice.progress.fraction === null ? " is-indeterminate" : ""}`}
              style={
                notice.progress.fraction === null
                  ? undefined
                  : ({ "--value": notice.progress.fraction } as CSSProperties)
              }
              role="progressbar"
              aria-label={notice.text}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                notice.progress.fraction === null
                  ? undefined
                  : Math.round(notice.progress.fraction * 100)
              }
            />
          )}
          {notice.action && (
            <button
              type="button"
              className="notice-cancel"
              onClick={notice.action.run}
            >
              {notice.action.label}
            </button>
          )}
          {notice.onCancel && notice.cancelLabel && (
            <button
              type="button"
              className="notice-cancel"
              onClick={() => notice.onCancel?.()}
            >
              {notice.cancelLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
