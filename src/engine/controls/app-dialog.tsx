import { useRef, useSyncExternalStore } from "react";
import { useModalDialog } from "./useModalDialog";
import { usePresence } from "../motion/usePresence";
import { isImeKeydown } from "../../utils/ime";
import { createRequestQueue } from "../../utils/store";
import { DialogActions } from "./DialogActions";

/**
 * The app's own alert, confirm and prompt boxes, in place of OS dialogs.
 * Callable from anywhere, shown by each window's AppDialogHost; requests queue.
 */
interface AppDialogOptions {
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
  /** Confirm only: the action destroys something (a delete); the phone draws
   *  its button in red. */
  danger?: boolean;
  /** Confirm only: start on the way out, for a question the user didn't ask
   *  for - an Enter typed on the way back must not do something irreversible. */
  focusCancel?: boolean;
  /** Choice only: a second way forward, beside the action button. */
  altLabel?: string;
  confirm: boolean;
  /** Prompt only: the text field's starting value, and its hint while
   *  empty. */
  input?: string;
  placeholder?: string;
  /** A box to tick under the text (Don't Ask Again), unticked at first. */
  checkLabel?: string;
  resolve: (ok: boolean, value?: string, checked?: boolean) => void;
}

const queue = createRequestQueue<Request>();

function enqueue(request: Omit<Request, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) =>
    queue.add((id) => ({ ...request, id, resolve })),
  );
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

/** A question with two ways forward: resolves "ok" for the action button,
 *  "alt" for the other, null for cancel, Escape or the backdrop. */
export function showChoice(
  text: string,
  options: AppDialogOptions & {
    okLabel: string;
    altLabel: string;
    cancelLabel: string;
    focusCancel?: boolean;
  },
): Promise<"ok" | "alt" | null> {
  return new Promise((resolve) =>
    queue.add((id) => ({
      ...options,
      text,
      confirm: true,
      id,
      resolve: (ok, value) => resolve(value === ALT ? "alt" : ok ? "ok" : null),
    })),
  );
}

/** What the second way forward answers with. */
const ALT = "\u0000alt";

/** A yes/no question with a box to tick under it (Don't Ask Again):
 *  whether the action button was pressed, and the box ticked then. */
export function showConfirmCheck(
  text: string,
  options: AppDialogOptions & {
    okLabel: string;
    cancelLabel: string;
    checkLabel: string;
  },
): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) =>
    queue.add((id) => ({
      ...options,
      text,
      confirm: true,
      id,
      resolve: (ok, _value, checked) =>
        resolve({ ok, checked: ok && !!checked }),
    })),
  );
}

/** A one-line text question (a new file name). Resolves the text, or null
 *  for cancel, Escape or the backdrop. */
export function showPrompt(
  text: string,
  value: string,
  options: AppDialogOptions & {
    okLabel: string;
    cancelLabel: string;
    placeholder?: string;
  },
): Promise<string | null> {
  return new Promise((resolve) =>
    queue.add((id) => ({
      ...options,
      text,
      confirm: true,
      input: value,
      id,
      resolve: (ok, typed) => resolve(ok ? (typed ?? value) : null),
    })),
  );
}

function answer(
  request: Request,
  ok: boolean,
  value?: string,
  checked?: boolean,
) {
  queue.remove(request.id);
  request.resolve(ok, value, checked);
}

/** Mounted once per window. */
export function AppDialogHost({ okLabel }: { okLabel: string }) {
  const current = useSyncExternalStore(queue.subscribe, queue.now);
  // The answered box stays a moment to fade out; a queued one takes its
  // place without the dimming going away and coming back.
  const presence = usePresence(!!current);
  const lastShown = useRef<Request | null>(null);
  if (current) lastShown.current = current;
  const shown = current ?? lastShown.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(
    () => current && answer(current, false),
    !!current,
    shown?.input !== undefined
      ? ".app-dialog-input"
      : shown?.focusCancel
        ? ".app-dialog-cancel"
        : ".close-prompt-primary",
    true,
    shown?.id,
  );
  const ok = () =>
    current &&
    answer(current, true, inputRef.current?.value, checkRef.current?.checked);
  if (!presence.mounted || !shown) return null;
  return (
    <div
      ref={presence.ref}
      data-state={presence.state}
      inert={presence.state === "closing" || undefined}
      className="tx-backdrop"
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
            className="tx-input app-dialog-input"
            defaultValue={shown.input}
            placeholder={shown.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeKeydown(e)) ok();
            }}
          />
        )}
        {shown.checkLabel && (
          <label className="app-dialog-check">
            <input ref={checkRef} type="checkbox" className="ui-check" />
            {shown.checkLabel}
          </label>
        )}
        <DialogActions>
          {shown.confirm && (
            <button
              className="tx-button app-dialog-cancel"
              onClick={() => current && answer(current, false)}
            >
              {shown.cancelLabel}
            </button>
          )}
          {shown.altLabel && (
            <button
              className="tx-button"
              onClick={() => current && answer(current, true, ALT)}
            >
              {shown.altLabel}
            </button>
          )}
          <button
            className={`tx-button primary close-prompt-primary${shown.danger ? " danger app-dialog-danger" : ""}`}
            onClick={ok}
          >
            {shown.confirm ? shown.okLabel : okLabel}
          </button>
        </DialogActions>
      </div>
    </div>
  );
}
