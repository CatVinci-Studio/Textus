import { thisWindow } from "../platform/this-window";
import { unlistenAll } from "../platform/events";
import { putBack } from "../engine/controls/scroll-hold";

/** How long after the window comes back a scroll the reader didn't make is
 *  taken back: the webview's own, as it puts the focus back at the caret. */
const SETTLE_MS = 400;
/** And until this many frames are drawn: on a slow computer the webview's
 *  scroll lands in a frame later than SETTLE_MS. */
const SETTLE_FRAMES = 2;
const READER_MOVES = ["wheel", "pointerdown", "keydown", "touchstart"];

/**
 * Coming back to the window from another app leaves each of `scrollers`
 * where it was being read: the webview, giving the editor its focus back,
 * scrolls to the caret (at the end, say, while the reader was further up).
 * The returned function stops it.
 */
export function holdOnReturn(scrollers: string): () => void {
  let kept = new Map<HTMLElement, number>();
  let until = 0;
  let frames = 0;
  let frame = 0;
  let stop = () => {};
  // Read while away too: a Mac scrolls a window in the background, and
  // where the reader took it is where it stays. A hidden one (no height)
  // has no place to keep.
  const follow = (e: Event) => {
    const el = e.target;
    if (el instanceof HTMLElement && kept.has(el)) kept.set(el, el.scrollTop);
  };
  const keep = () => {
    kept = new Map(
      [...document.querySelectorAll<HTMLElement>(scrollers)]
        .filter((el) => el.clientHeight > 0)
        .map((el) => [el, el.scrollTop]),
    );
    document.addEventListener("scroll", follow, true);
  };
  // The page's focus comes back before the window says so: from then on a
  // scroll is the webview's, not the reader's.
  const unfollow = () => document.removeEventListener("scroll", follow, true);
  window.addEventListener("focus", unfollow, true);
  const putKept = (el: HTMLElement) => {
    const top = kept.get(el);
    if (top !== undefined) putBack(el, top);
  };
  const onScroll = (e: Event) => {
    if (performance.now() > until && frames >= SETTLE_FRAMES) return stop();
    if (e.target instanceof HTMLElement) putKept(e.target);
  };
  // The reader's own move ends the hold at once; a click that brought
  // the window back (onto the outline, say) means to go somewhere.
  const release = () => stop();
  let pressedAt = 0;
  const pressed = () => (pressedAt = performance.now());
  window.addEventListener("pointerdown", pressed, true);
  const back = () => {
    unfollow();
    stop();
    if (performance.now() - pressedAt < SETTLE_MS) return;
    until = performance.now() + SETTLE_MS;
    frames = 0;
    const drawn = () => {
      if (++frames < SETTLE_FRAMES) frame = requestAnimationFrame(drawn);
    };
    frame = requestAnimationFrame(drawn);
    for (const el of kept.keys()) putKept(el);
    document.addEventListener("scroll", onScroll, true);
    for (const type of READER_MOVES)
      window.addEventListener(type, release, true);
    stop = () => {
      until = 0;
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, true);
      for (const type of READER_MOVES)
        window.removeEventListener(type, release, true);
    };
  };
  // The window's own focus, not the page's: a plugin's frame taking the
  // keys is not leaving.
  const unlisten = thisWindow().onFocusChanged(({ payload: focused }) =>
    focused ? back() : keep(),
  );
  return () => {
    stop();
    unfollow();
    window.removeEventListener("focus", unfollow, true);
    unlistenAll(unlisten)();
    window.removeEventListener("pointerdown", pressed, true);
  };
}
