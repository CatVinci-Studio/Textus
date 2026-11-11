import { frameLayout } from "../frame/frame-store";
import { panesOf } from "./tree";
import { splitLayout } from "./store";

/**
 * The islands' numbers: with ⌘ (Ctrl) held alone for a moment and two or
 * more islands in the window, each shows a number, and ⌘1–⌘6 goes to that
 * island instead of making a heading. Letting ⌘ go, any other key, a press
 * of the pointer or the window losing the focus takes them away.
 */

/** How long ⌘ is held alone before the numbers show. */
export const HOLD_MS = 500;
/** As many islands as ⌘ has heading keys. */
const MOST = 6;

type Hold = "idle" | "waiting" | "shown";

/** What the hold hears: a key going down (`mod`: the ⌘ key itself, no
 *  other modifier with it; `digit`: ⌘ with 1–6), ⌘ let go or the window
 *  left (`end`), and its own timer, told how many islands there are. */
type HoldEvent =
  | { type: "key"; mod: boolean; digit: boolean; repeat: boolean }
  | { type: "end" }
  | { type: "timer"; islands: number };

/** The hold after `event`. A key pressed while waiting ends the wait until
 *  ⌘ is pressed anew: ⌘C held a little long shows nothing. */
export function holdStep(state: Hold, event: HoldEvent): Hold {
  if (event.type === "end") return "idle";
  if (event.type === "timer")
    return state === "waiting" && event.islands >= 2 ? "shown" : state;
  if (event.mod) return event.repeat || state !== "idle" ? state : "waiting";
  return state === "shown" && event.digit ? "shown" : "idle";
}

interface IslandAnchor {
  paneId: string;
  rect: DOMRect;
}

/** Where each island is, in reading order: the one place the numbers and
 *  the keys take the islands from. */
export function islandAnchors(): IslandAnchor[] {
  const layout = splitLayout();
  if (!layout) return [];
  const placed = new Map(
    frameLayout().islands.map((island) => [island.paneId, island.sheet]),
  );
  return panesOf(layout.root)
    .flatMap((pane) => {
      const r = placed.get(pane.id);
      return r
        ? [{ paneId: pane.id, rect: new DOMRect(r.x, r.y, r.w, r.h) }]
        : [];
    })
    .slice(0, MOST);
}

let hold: Hold = "idle";
const listeners = new Set<() => void>();

function set(next: Hold) {
  if (next === hold) return;
  const was = hold;
  hold = next;
  if ((was === "shown") !== (next === "shown"))
    for (const listener of listeners) listener();
}

export function islandNumbersShown(): boolean {
  return hold === "shown";
}

export function subscribeIslandNumbers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let go: ((tabId: string) => void) | null = null;

/**
 * ⌘`n` pressed: while the numbers show, goes to island `n`'s tab in front
 * and answers true - the key is taken, whether there is such an island or
 * not. False while they don't: the key is a heading's.
 */
export function pickIsland(n: number): boolean {
  if (hold !== "shown") return false;
  const anchor = islandAnchors()[n - 1];
  const layout = splitLayout();
  const front =
    anchor &&
    layout &&
    panesOf(layout.root).find((pane) => pane.id === anchor.paneId)?.front;
  if (front) go?.(front);
  return true;
}

/**
 * Watches the window's keys for the hold; `onPick` brings a tab to the
 * front when its island's number is pressed. `meta`: ⌘ is the key (a
 * Mac), else Ctrl.
 */
export function watchIslandNumbers(
  meta: boolean,
  onPick: (tabId: string) => void,
): () => void {
  go = onPick;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = (event: HoldEvent) => {
    const was = hold;
    set(holdStep(hold, event));
    if (hold === was) return;
    clearTimeout(timer);
    if (hold === "waiting")
      timer = setTimeout(
        () => step({ type: "timer", islands: islandAnchors().length }),
        HOLD_MS,
      );
  };
  const name = meta ? "Meta" : "Control";
  const down = (e: KeyboardEvent) => {
    const others =
      e.altKey || e.shiftKey || (meta ? e.ctrlKey : e.metaKey) || e.isComposing;
    const held = meta ? e.metaKey : e.ctrlKey;
    step({
      type: "key",
      mod: e.key === name && !others,
      digit: held && !others && /^[1-6]$/.test(e.key),
      repeat: e.repeat,
    });
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === name) step({ type: "end" });
  };
  const end = () => step({ type: "end" });
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("blur", end);
  window.addEventListener("pointerdown", end, true);
  return () => {
    end();
    go = null;
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", end);
    window.removeEventListener("pointerdown", end, true);
  };
}
