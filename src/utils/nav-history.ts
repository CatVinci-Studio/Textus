/**
 * Back and Forward: the places a jump left - a followed link, an outline
 * heading, another tab - as a tab and how far down it was scrolled.
 */

export interface NavPlace {
  tabId: string;
  top: number;
}

const MAX = 50;
/** Within this many pixels, two places are one. */
const NEAR = 40;

export class NavHistory {
  private back: NavPlace[] = [];
  private forward: NavPlace[] = [];

  /** A jump is leaving `place`: Back returns to it, Forward is forgotten. */
  leave(place: NavPlace): void {
    const last = this.back.at(-1);
    if (last?.tabId === place.tabId && Math.abs(last.top - place.top) < NEAR)
      return;
    this.back.push(place);
    if (this.back.length > MAX) this.back.shift();
    this.forward = [];
  }

  /** The place one step back (-1) or forward (1) from `here`, skipping
   *  tabs since closed; null at the end. */
  step(
    direction: -1 | 1,
    here: NavPlace | null,
    alive: (tabId: string) => boolean,
  ): NavPlace | null {
    const [from, to] =
      direction < 0 ? [this.back, this.forward] : [this.forward, this.back];
    for (let place = from.pop(); place; place = from.pop()) {
      if (!alive(place.tabId)) continue;
      if (here) to.push(here);
      return place;
    }
    return null;
  }
}

export const navHistory = new NavHistory();

function scrollerIn(tab: Element | null): HTMLElement | null {
  return tab?.querySelector<HTMLElement>(".editor-scroll") ?? null;
}

export function tabScroller(tabId: string): HTMLElement | null {
  return scrollerIn(
    document.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`),
  );
}

/** Where the front tab is now. */
export function frontPlace(): NavPlace | null {
  const tab = document.querySelector<HTMLElement>('[data-active-tab="true"]');
  const tabId = tab?.dataset.tabId;
  const scroller = scrollerIn(tab);
  return tabId && scroller ? { tabId, top: scroller.scrollTop } : null;
}

/** Called before a jump within the front document. */
export function noteJump(): void {
  const here = frontPlace();
  if (here) navHistory.leave(here);
}
