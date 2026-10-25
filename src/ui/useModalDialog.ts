import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePhoneLayout } from "./usePhoneLayout";
import { usePresenceState } from "./usePresence";

// `summary` is a <details> toggle: without it Settings' folded Advanced
// group can't be reached by Tab - the wrap goes back to the close button.
const FOCUSABLE =
  ':is(button, input, select, textarea, summary, a[href], [tabindex]):not(:disabled):not([tabindex="-1"]):not([type="hidden"])';

/** The open modal dialogs, innermost last - the one a key that lost its
 *  target belongs to. */
const openDialogs: HTMLElement[] = [];

/** Shared focus lifecycle for modal dialogs; callers provide role and label.
 *  `refocusEditorOnPhone: false` leaves the keyboard down on a phone when
 *  the dialog closes, instead of handing the focus back to the editor.
 *
 *  Inside a Presence (ui/usePresence.ts) the dialog counts as closed the
 *  moment its exit starts: focus goes back then, not once it has faded. */
export function useModalDialog(
  onClose: () => void,
  enabled = true,
  initialFocusSelector?: string,
  refocusEditorOnPhone = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const phone = usePhoneLayout();
  const presence = usePresenceState();
  const active = enabled && presence === "open";
  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    // Where the caret was in the text the focus leaves: focus() alone puts
    // a contenteditable's caret at its start, and a plugin's dialog then
    // wrote at the top of the document instead of where the user was.
    const selection = window.getSelection();
    const caret =
      previous instanceof HTMLElement &&
      previous.isContentEditable &&
      selection &&
      selection.rangeCount > 0
        ? selection.getRangeAt(0).cloneRange()
        : null;
    let first =
      (initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : null) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    // On a phone a button is pressed, not focused: nothing iOS draws
    // starts with one, and a focused button only waits for an Enter no
    // one will type. A text field still takes the focus - the keyboard
    // coming up is what the dialog is asking for.
    if (phone && first && !first.matches("input, textarea")) first = null;
    const target = first ?? dialog;
    target.focus();
    // The ring is for finding your place with the keyboard. A dialog opened
    // by a click or a shortcut starts on its button without one; the first
    // key pressed in it brings it back (design-system.css, data-quiet-focus).
    const quiet =
      target === document.activeElement && !target.matches("input, textarea");
    const speak = () => target.removeAttribute("data-quiet-focus");
    if (quiet) {
      target.setAttribute("data-quiet-focus", "");
      window.addEventListener("keydown", speak, { capture: true, once: true });
      target.addEventListener("blur", speak, { once: true });
    }
    // A control that goes away under the focus - Import CSS… disabled
    // while it reads the file, Delete Theme removed with its theme - drops
    // the focus to <body>, outside the dialog, where its own Escape and Tab
    // handling never hear a key again. A key that arrives there belongs to
    // the innermost open dialog: it takes the focus back, and Escape still
    // closes it.
    openDialogs.push(dialog);
    const strayKey = (event: globalThis.KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      const focused = document.activeElement;
      if (focused && focused !== document.body) return;
      if (event.isComposing) return;
      dialog.focus();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", strayKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", strayKey, { capture: true });
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      window.removeEventListener("keydown", speak, { capture: true });
      target.removeEventListener("blur", speak);
      speak();
      if (!(previous instanceof HTMLElement) || !previous.isConnected) return;
      // On a phone, focusing the editor again brings the keyboard back up.
      // After Settings that covers a page the user only meant to return to;
      // after inserting a table it is where they go on typing, so only the
      // caller can say.
      if (phone && !refocusEditorOnPhone && previous.isContentEditable) return;
      previous.focus({ preventScroll: true });
      if (caret && previous.contains(caret.startContainer)) {
        const now = window.getSelection();
        now?.removeAllRanges();
        now?.addRange(caret);
      }
    };
  }, [active, initialFocusSelector, phone, refocusEditorOnPhone]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const elements = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(
      (el) =>
        !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
        // A folded <details> still has its controls in the DOM, unrendered:
        // counting one as "last" would stop the wrap after its summary.
        !el.closest("details:not([open]) > :not(summary)") &&
        getComputedStyle(el).display !== "none" &&
        getComputedStyle(el).visibility !== "hidden",
    );
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first) {
      event.preventDefault();
      ref.current?.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === ref.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return { ref, onKeyDown, tabIndex: -1 };
}
