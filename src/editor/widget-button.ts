import { tellCopied } from "../clipboard/copied";

/** How long a Copy button says it copied. */
export const COPIED_MS = 1500;

/** A button drawn inside the document (a widget, a node view's tool): a
 *  press leaves the editor's caret and selection where they are, and its
 *  click is its own, not the editor's. */
export function widgetButton(
  className: string,
  text: string,
  onClick: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(button);
  });
  return button;
}

/** A Copy pill: `text()` to the clipboard, then "Copied" for a moment. */
export function copyButton(
  labels: () => { copy: string; copied: string },
  text: () => string,
): HTMLButtonElement {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return widgetButton("block-pill", labels().copy, (button) => {
    const copied = text();
    void navigator.clipboard.writeText(copied).then(
      () => {
        // navigator.clipboard bypasses the copy event.
        tellCopied(copied);
        button.textContent = labels().copied;
        button.classList.add("is-copied");
        clearTimeout(timer);
        timer = setTimeout(() => {
          button.textContent = labels().copy;
          button.classList.remove("is-copied");
        }, COPIED_MS);
      },
      () => {
        // No clipboard access: nothing was copied, nothing to say.
      },
    );
  });
}
