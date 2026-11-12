import { useEffect, type RefObject } from "react";
import { onAppearance } from "../tokens/appearance";

/**
 * The least width each island's content can be laid out in - its longest
 * unbreakable line: a setting's name with the smallest control, a word in
 * a long language - measured from the content, so the solver never gives
 * an island less (island-rules.ts). Its one owner, by pane.
 */
const mins = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function told() {
  version++;
  for (const tell of listeners) tell();
}

/** The measured least width of pane `id`'s content, 0 if none was. */
export function contentMinOf(id: string): number {
  return mins.get(id) ?? 0;
}

export function onContentMin(changed: () => void): () => void {
  listeners.add(changed);
  return () => listeners.delete(changed);
}

export function contentMinVersion(): number {
  return version;
}

export function setContentMin(id: string, px: number | null): void {
  const was = mins.get(id) ?? null;
  if (px === was) return;
  if (px === null) mins.delete(id);
  else mins.set(id, px);
  told();
}

/** Its own padding and border and its ancestors' up to the island: what
 *  surrounds `inner` at any width. */
function chromeAround(inner: Element, island: Element): number {
  let px = 0;
  for (
    let el: Element | null = inner.parentElement;
    el;
    el = el.parentElement
  ) {
    const s = getComputedStyle(el);
    px +=
      parseFloat(s.paddingLeft) +
      parseFloat(s.paddingRight) +
      parseFloat(s.borderLeftWidth) +
      parseFloat(s.borderRightWidth);
    if (el === island) break;
  }
  return px;
}

/** What a line cut short with "…" keeps: a few characters. */
const CUT_LINE_KEEPS = "6ch";

/** `inner` laid out as narrow as it goes, its border box's width. A line
 *  cut short with "…", or a box that scrolls sideways, gives way down to a
 *  few characters rather than counting its whole width. */
function minContent(inner: HTMLElement): number {
  // A box that scrolls sideways (a code block, a wide table) holds its own
  // width: it gives way as a cut line does.
  const cut = [...inner.querySelectorAll<HTMLElement>("*")].filter((el) => {
    const s = getComputedStyle(el);
    return (
      (s.textOverflow === "ellipsis" && s.overflowX !== "visible") ||
      s.overflowX === "auto" ||
      s.overflowX === "scroll"
    );
  });
  const kept = cut.map((el) => [el.style.contain, el.style.minWidth]);
  for (const el of cut) {
    el.style.contain = "inline-size";
    el.style.minWidth = CUT_LINE_KEEPS;
  }
  const was = inner.style.width;
  inner.style.width = "min-content";
  const w = inner.getBoundingClientRect().width;
  inner.style.width = was;
  cut.forEach((el, i) => {
    el.style.contain = kept[i][0];
    el.style.minWidth = kept[i][1];
  });
  return w;
}

/**
 * Reports the least width of the content under `root` for the island it
 * is in: `inner` (a selector under `root`) measured at its narrowest, plus
 * what surrounds it. Measured again a frame after its content or the
 * interface changes; let go when it goes.
 */
export function useContentMin(
  root: RefObject<HTMLElement | null>,
  inner: string,
): void {
  useEffect(() => {
    const el = root.current;
    const island = el?.closest<HTMLElement>("[data-pane-id]");
    const id = island?.dataset.paneId;
    if (!el || !island || !id) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const target = el.querySelector<HTMLElement>(inner);
      // Not laid out (hidden for now): the last measure stands.
      if (!target || !target.getClientRects().length) return;
      setContentMin(
        id,
        Math.ceil(minContent(target) + chromeAround(target, island)),
      );
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    soon();
    const changed = new MutationObserver(soon);
    changed.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const restyled = onAppearance(soon);
    return () => {
      cancelAnimationFrame(frame);
      changed.disconnect();
      restyled();
      setContentMin(id, null);
    };
  }, [root, inner]);
}
