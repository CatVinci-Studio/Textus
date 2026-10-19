import { useEffect, useRef, useState } from "react";
import { useModalDialog } from "./useModalDialog";
import { usePresence } from "./usePresence";

/**
 * The app's own alert and confirm boxes, in place of the OS dialogs
 * (@tauri-apps/plugin-dialog's `message`/`ask`), which drew a GTK or Win32
 * box in the middle of an otherwise themed window. Callable from anywhere -
 * export code and editor plugins have no React tree of their own - and
 * shown by the one AppDialogHost each window mounts (App, and the detached
 * chat window's ChatWindowApp). Requests queue: a second one waits for the
 * first to be answered.
 */
export interface AppDialogOptions {
  title?: string;
  /** Tints the title; a plain notice by default. */
  tone?: "info" | "warning" | "error";
}

interface Request extends AppDialogOptions {
  id: number;
  text: string;
  /** Confirm only: the action button and the way out. */
  okLabel?: string;
  cancelLabel?: string;
  /** Confirm only: the action destroys something (a delete). The phone's
   *  alert draws its button in red (mobile/styles/chrome.css); elsewhere
   *  it is the usual primary button. */
  danger?: boolean;
  /** Confirm only: start on the way out instead of the action, for a
   *  question the user didn't ask for (an autosave conflict) - an Enter
   *  typed on the way back must not do something that can't be undone. */
  focusCancel?: boolean;
  confirm: boolean;
  /** Prompt only: the text field's starting value. */
  input?: string;
  resolve: (ok: boolean, value?: string) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(queue: Request[]) => void>();

function publish() {
  for (const listener of listeners) listener(queue);
}

function enqueue(request: Omit<Request, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, id: nextId++, resolve }];
    publish();
  });
}

/** A notice with one button. Resolves once it is dismissed. */
export async function showMessage(
  text: string,
  options: AppDialogOptions = {},
): Promise<void> {
  await enqueue({ ...options, text, confirm: false });
}

/** A yes/no question. Resolves true for the action button, false for
 *  cancel, Escape or the backdrop. */
export function showConfirm(
  text: string,
  options: AppDialogOptions & {
    okLabel: string;
    cancelLabel: string;
    danger?: boolean;
    focusCancel?: boolean;
  },
): Promise<boolean> {
  return enqueue({ ...options, text, confirm: true });
}

/** A one-line text question (a new file name). Resolves the text, or null
 *  for cancel, Escape or the backdrop. */
export function showPrompt(
  text: string,
  value: string,
  options: AppDialogOptions & { okLabel: string; cancelLabel: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        ...options,
        text,
        confirm: true,
        input: value,
        id: nextId++,
        resolve: (ok, typed) => resolve(ok ? (typed ?? value) : null),
      },
    ];
    publish();
  });
}

function answer(request: Request, ok: boolean, value?: string) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(ok, value);
}

/** Mounted once per window: by App, and by ChatWindowApp. */
export function AppDialogHost({ okLabel }: { okLabel: string }) {
  const [pending, setPending] = useState<Request[]>(queue);
  useEffect(() => {
    listeners.add(setPending);
    return () => {
      listeners.delete(setPending);
    };
  }, []);
  const current = pending[0];
  // The answered box stays a moment to fade out; a queued one takes its
  // place without the dimming going away and coming back.
  const presence = usePresence(!!current, { exitMs: 150 });
  const lastShown = useRef<Request | null>(null);
  if (current) lastShown.current = current;
  const shown = current ?? lastShown.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(
    () => current && answer(current, false),
    !!current,
    shown?.input !== undefined
      ? ".app-dialog-input"
      : shown?.focusCancel
        ? ".app-dialog-cancel"
        : ".close-prompt-primary",
  );
  const ok = () => current && answer(current, true, inputRef.current?.value);
  if (!presence.mounted || !shown) return null;
  return (
    <div
      ref={presence.ref}
      data-state={presence.state}
      inert={presence.state === "closing" || undefined}
      className="close-prompt-overlay"
      onMouseDown={(e) => {
        if (current && e.target === e.currentTarget) answer(current, false);
      }}
    >
      <div
        key={shown.id}
        className="close-prompt app-dialog"
        {...dialog}
        role={shown.confirm ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-label={shown.title ?? shown.text}
      >
        {shown.title && (
          <h2 className={`app-dialog-title app-dialog-${shown.tone ?? "info"}`}>
            {shown.title}
          </h2>
        )}
        <p>{shown.text}</p>
        {shown.input !== undefined && (
          <input
            ref={inputRef}
            className="app-dialog-input"
            defaultValue={shown.input}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) ok();
            }}
          />
        )}
        <div className="close-prompt-buttons">
          <div className="close-prompt-spacer" />
          {shown.confirm && (
            <button
              className="app-dialog-cancel"
              onClick={() => current && answer(current, false)}
            >
              {shown.cancelLabel}
            </button>
          )}
          <button
            className={`close-prompt-primary${shown.danger ? " app-dialog-danger" : ""}`}
            onClick={ok}
          >
            {shown.confirm ? shown.okLabel : okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
