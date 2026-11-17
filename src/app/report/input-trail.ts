/**
 * What the window's focus and its input method did lately, for a problem
 * report: when the window was left and come back to, and when an input
 * method's keys came with no composition (Windows' WebView2 can lose its
 * IME that way until a restart). In memory only, never written anywhere.
 */
const KEPT = 20;
/** Input-method keys with no composition before it counts as stuck. */
const STUCK_AFTER = 5;
const trail: string[] = [];

function keep(text: string) {
  trail.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
  if (trail.length > KEPT) trail.shift();
}

export function watchInput(): void {
  let imeKeys = 0;
  window.addEventListener("focus", () => {
    imeKeys = 0;
    keep("window focused");
  });
  window.addEventListener("blur", () => keep("window left"));
  document.addEventListener(
    "compositionstart",
    () => (imeKeys = -Infinity),
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      // The key an input method takes is "Process" until it composes.
      if (e.key !== "Process" || ++imeKeys !== STUCK_AFTER) return;
      const at = document.activeElement;
      keep(
        `input method keys with no composition (in ${at?.tagName.toLowerCase() ?? "nothing"}${at?.closest(".ProseMirror") ? ", editor" : ""})`,
      );
    },
    true,
  );
}

export function inputTrail(): readonly string[] {
  return trail;
}
