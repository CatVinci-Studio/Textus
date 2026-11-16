import "./hold-keyboard.css";

/** How long the stand-in waits for the field it holds the keyboard for. */
const WAIT_MS = 1500;

/**
 * On a touch screen the keyboard rises only for a focus made inside the
 * tap. A field the tap opens a moment later (Find's) gets it from this
 * stand-in: focused now, it hands the keyboard on to the next field
 * focused, then goes.
 */
export function holdKeyboard(): void {
  const stand = document.createElement("input");
  stand.setAttribute("aria-hidden", "true");
  stand.tabIndex = -1;
  stand.className = "tx-keyboard-stand-in";
  document.body.append(stand);
  stand.focus({ preventScroll: true });
  const done = () => {
    clearTimeout(timer);
    document.removeEventListener("focusin", moved, true);
    stand.remove();
  };
  const moved = (e: FocusEvent) => {
    if (e.target !== stand) done();
  };
  document.addEventListener("focusin", moved, true);
  const timer = setTimeout(done, WAIT_MS);
}
