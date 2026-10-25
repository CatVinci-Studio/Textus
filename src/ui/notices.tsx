import { useEffect, useState } from "react";
import "./notices.css";

/**
 * Short notes at the bottom of the window that go by themselves, and
 * progress bars for slow work (textus.ui.notice / withProgress): what a
 * plugin says without stopping the user, unlike app-dialog's boxes.
 * Callable from anywhere; shown by the one NoticeHost App mounts.
 */

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "warning" | "error";
  /** Who says it (a plugin's name), before the text. */
  source?: string;
  /** A progress bar: 0 to 1, or null while it can't tell. */
  progress?: { fraction: number | null; message?: string };
  cancelLabel?: string;
  onCancel?: () => void;
}

/** How long a note stays: long enough to read a line. */
const NOTICE_MS = 4500;
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
  notices = notices.filter((n) => n.id !== id);
  publish();
}

function add(notice: Omit<Notice, "id">): number {
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
  options: { tone?: Notice["tone"]; source?: string } = {},
): void {
  const id = add({
    text,
    tone: options.tone ?? "info",
    source: options.source,
  });
  timers.set(
    id,
    setTimeout(() => remove(id), NOTICE_MS),
  );
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
              className="notice-bar"
              role="progressbar"
              aria-label={notice.text}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                notice.progress.fraction === null
                  ? undefined
                  : Math.round(notice.progress.fraction * 100)
              }
            >
              <div
                className={`notice-bar-fill${notice.progress.fraction === null ? " is-indeterminate" : ""}`}
                style={
                  notice.progress.fraction === null
                    ? undefined
                    : { transform: `scaleX(${notice.progress.fraction})` }
                }
              />
            </div>
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
