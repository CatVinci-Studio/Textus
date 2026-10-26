/** The scrollers whose bar shows only while they move. */
const REVEAL_SELECTOR = ".editor-scroll, .source-view";
/** How long the bar stays after the last scroll step. */
const HIDE_AFTER_MS = 900;

/** The document's scrollbar shows while it scrolls and fades after. One
 *  capture-phase listener serves every tab's scroller, since scroll doesn't
 *  bubble. */
export function installScrollReveal(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target;
      if (!(el instanceof Element) || !el.matches(REVEAL_SELECTOR)) return;
      el.classList.add("is-scrolling");
      window.clearTimeout(timers.get(el));
      timers.set(
        el,
        window.setTimeout(
          () => el.classList.remove("is-scrolling"),
          HIDE_AFTER_MS,
        ),
      );
    },
    { capture: true, passive: true },
  );
}
