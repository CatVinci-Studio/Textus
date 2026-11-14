import { fontOf, textWidth } from "../text-measure";
import { tabWidths, type TabFit } from "./tab-widths";

/**
 * A tab row's measures as its stylesheet draws it, read from the page, and
 * the tabs fitted to them (tab-widths.ts). The measures hold for any tabs
 * the row gets: only its width, the interface's size or a theme change
 * them.
 */

/** What a tab is made of, whatever its name. */
export interface PillMeasures {
  /** Its name's font. */
  font: string;
  /** How much wider the page draws a name than the canvas measures it
   *  (1 where they agree): the check that keeps a whole name from being
   *  cut when a font or its spacing differs from what the canvas knows. */
  textFix: number;
  /** Its padding and borders, both sides. */
  pad: number;
  /** Between its parts. */
  gap: number;
  close: number;
  dot: number;
  lock: number;
  /** Its count of waiting revisions with one digit, and each more digit. */
  waiting: number;
  digit: number;
  min: number;
  max: number;
  shrink: boolean;
  /** What its `width` leaves out of its box (its padding and borders
   *  where it is sized by its content box). */
  outside: number;
}

export interface TabRoom {
  /** The row's width its tabs may take, the gaps between them included. */
  available: number;
  /** Between two tabs. */
  between: number;
  /** The list button's width, held at the row's end once tabs overflow. */
  list: number;
  pill: PillMeasures;
}

/** What of a tab decides its width. */
export interface TabShape {
  title: string;
  dirty?: boolean;
  preview?: boolean;
  readOnly?: boolean;
  waiting?: number;
}

const px = (value: string) => parseFloat(value) || 0;

/** An element's width as laid out, margins included: not as drawn, which
 *  a slide or an entrance scales. */
function laidOut(el: Element): number {
  const style = getComputedStyle(el);
  const sides =
    style.boxSizing === "border-box"
      ? 0
      : px(style.paddingLeft) +
        px(style.paddingRight) +
        px(style.borderLeftWidth) +
        px(style.borderRightWidth);
  return px(style.width) + sides + px(style.marginLeft) + px(style.marginRight);
}

/** A copy of `pill` with every part a tab can have, in the row for a
 *  moment and never drawn: measured as the row's stylesheet makes it. */
function measurePill(strip: HTMLElement, pill: HTMLElement): PillMeasures {
  const probe = pill.cloneNode(true) as HTMLElement;
  probe.removeAttribute("data-tab");
  probe.removeAttribute("data-strip-key");
  probe.removeAttribute("style");
  probe.classList.remove("tab-pill-looking");
  probe.style.cssText = "position:absolute;visibility:hidden;animation:none";
  const title = probe.querySelector(".tab-pill-title")!;
  // A part this tab lacks is copied from a tab of the row that has it;
  // while none does, it measures as its bare box and is read again once
  // one shows (useTabFit).
  const part = (name: string) => {
    const has = probe.querySelector(`.${name}`);
    if (has) return has;
    const made =
      strip.querySelector(`.${name}`)?.cloneNode(true) ??
      Object.assign(document.createElement("span"), { className: name });
    title.before(made);
    return made as Element;
  };
  const dot = part("tab-pill-dirty-dot");
  const lock = part("tab-pill-lock");
  const waiting = part("tab-pill-waiting");
  waiting.textContent = "0";
  title.after(waiting);
  (title as HTMLElement).style.cssText = "flex:none;overflow:visible";
  strip.append(probe);
  const style = getComputedStyle(probe);
  const pad =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth);
  const outside = style.boxSizing === "border-box" ? 0 : pad;
  const close = probe.querySelector(".tab-pill-close");
  const font = fontOf(title);
  const drawn = title.getBoundingClientRect().width;
  const measured = textWidth(title.textContent ?? "", font) ?? 0;
  const measures: PillMeasures = {
    font,
    textFix: drawn > 0 && measured > 0 ? Math.max(1, drawn / measured) : 1,
    pad,
    gap: px(style.columnGap),
    // Not its margin: the free room it is pushed to the end with.
    close: close ? laidOut(close) - px(getComputedStyle(close).marginLeft) : 0,
    dot: laidOut(dot),
    lock: laidOut(lock),
    waiting: laidOut(waiting),
    digit: textWidth("0", fontOf(waiting)) ?? 0,
    min: px(style.minWidth) + outside,
    max: style.maxWidth === "none" ? Infinity : px(style.maxWidth) + outside,
    shrink: style.flexShrink !== "0",
    outside,
  };
  probe.remove();
  return measures;
}

/** The row's measures now; null while it has no tab to measure by or is
 *  not laid out. `pill`: a tab's measures already read, which only the
 *  interface's size, a font or a theme change, not the row's width. */
export function readTabRoom(
  bar: HTMLElement,
  pill?: PillMeasures,
): TabRoom | null {
  const strip = bar.querySelector<HTMLElement>(":scope > .tab-strip");
  const tab = strip?.querySelector<HTMLElement>(
    ":scope > .tab-pill:not(.tab-pill-preview)",
  );
  if (!strip || !tab) return null;
  const style = getComputedStyle(bar);
  const between = px(style.columnGap);
  const inner =
    px(style.width) -
    (style.boxSizing === "border-box"
      ? px(style.paddingLeft) + px(style.paddingRight)
      : 0);
  if (!(inner > 0)) return null;
  // What else stands in the row: its +. Not its list of tabs, which shows
  // only once they overflow.
  let taken = 0;
  for (const child of bar.children) {
    if (child.matches(".tab-strip, .tab-bar-list")) continue;
    if (/absolute|fixed/.test(getComputedStyle(child).position)) continue;
    taken += laidOut(child) + between;
  }
  return {
    available: Math.floor(inner - taken),
    between,
    list: px(style.getPropertyValue("--icon-button-s")),
    pill: pill ?? measurePill(strip, tab),
  };
}

export function sameRoom(a: TabRoom | null, b: TabRoom | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Each tab's width in a row with these measures, and whose name is cut. */
export function fitTabs(tabs: readonly TabShape[], room: TabRoom): TabFit {
  const { pill } = room;
  const parts = tabs.map((tab) => ({
    title: Math.ceil(
      (textWidth(tab.title, tab.preview ? `italic ${pill.font}` : pill.font) ??
        0) * pill.textFix,
    ),
    fixed:
      pill.pad +
      pill.close +
      pill.gap +
      (tab.dirty ? pill.dot + pill.gap : 0) +
      (tab.readOnly ? pill.lock + pill.gap : 0) +
      (tab.waiting
        ? pill.waiting +
          pill.digit * (String(tab.waiting).length - 1) +
          pill.gap
        : 0),
  }));
  const fit = tabWidths(
    parts,
    pill,
    room.available,
    room.between,
    room.available - room.list,
  );
  return pill.outside
    ? { ...fit, widths: fit.widths.map((width) => width - pill.outside) }
    : fit;
}
