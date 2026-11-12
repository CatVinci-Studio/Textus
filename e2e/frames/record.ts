import type { Page } from "@playwright/test";
import type { Frame } from "./claims";

/**
 * Records where blocks are in every frame of a motion: `targets` names a
 * selector each, `act` starts the motion, and for `ms` after it each
 * frame's boxes are kept (claims.ts checks them). A target is looked up
 * anew each frame, so one the motion adds is recorded from its first.
 */
export async function recordFrames(
  page: Page,
  targets: Record<string, string>,
  act: () => Promise<void>,
  ms = 700,
): Promise<Frame[]> {
  await page.evaluate(startRecording, targets);
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() =>
    (window as unknown as { __frames: { stop(): Frame[] } }).__frames.stop(),
  );
}

/** Marks every element `selector` matches now as `prefix`0, `prefix`1…,
 *  and gives the targets that find them again: blocks told apart by what
 *  they were before the motion, whatever it does to their order. */
export async function markEach(
  page: Page,
  selector: string,
  prefix: string,
): Promise<Record<string, string>> {
  const count = await page.evaluate(
    ([selector, prefix]) => {
      const all = [...document.querySelectorAll<HTMLElement>(selector!)];
      all.forEach((el, i) => (el.dataset.frameMark = `${prefix}${i}`));
      return all.length;
    },
    [selector, prefix],
  );
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `${prefix}${i}`,
      `[data-frame-mark="${prefix}${i}"]`,
    ]),
  );
}

/** Runs in the page. */
function startRecording(targets: Record<string, string>) {
  type Box = NonNullable<Frame["boxes"][string]>;
  const frames: Frame[] = [];
  let on = true;
  const start = performance.now();

  /** A computed clip-path's inset(), as px in from each side of `box`. */
  const insetOf = (clip: string, box: DOMRect) => {
    const inside = /^inset\(([^)]*)\)/.exec(clip)?.[1];
    if (!inside) return null;
    const parts = inside.split(" round ")[0]!.trim().split(/\s+/);
    const px = (part: string | undefined, of: number) =>
      part === undefined
        ? NaN
        : part.endsWith("%")
          ? (parseFloat(part) / 100) * of
          : parseFloat(part);
    const top = px(parts[0], box.height);
    const right = px(parts[1] ?? parts[0], box.width);
    const bottom = px(parts[2] ?? parts[0], box.height);
    const left = px(parts[3] ?? parts[1] ?? parts[0], box.width);
    return [top, right, bottom, left].some(Number.isNaN)
      ? null
      : { top, right, bottom, left };
  };

  const boxOf = (el: Element): Box => {
    const box = el.getBoundingClientRect();
    let opacity = 1;
    let left = Math.max(box.left, 0);
    let right = Math.min(box.right, innerWidth);
    for (let at: Element | null = el; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      opacity *= parseFloat(style.opacity);
      const around = at === el ? box : at.getBoundingClientRect();
      const inset = insetOf(style.clipPath, around);
      if (inset) {
        left = Math.max(left, around.left + inset.left);
        right = Math.min(right, around.right - inset.right);
      }
      if (at !== el && style.overflowX !== "visible") {
        left = Math.max(left, around.left);
        right = Math.min(right, around.right);
      }
    }
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      opacity,
      shownWidth: Math.max(0, right - left),
    };
  };

  // Read in a task posted from the frame's callback: it runs once the
  // frame is drawn, so the boxes are the ones painted, after whatever
  // other frame callbacks and resize observers did to them.
  const painted = new MessageChannel();
  painted.port1.onmessage = () => {
    if (!on) return;
    const t = performance.now() - start;
    // A busy page runs several frames' tasks at once: one reading of them.
    if (frames.length && t - frames[frames.length - 1]!.t < 2) return;
    const boxes: Frame["boxes"] = {};
    for (const [name, selector] of Object.entries(targets)) {
      const el = document.querySelector(selector);
      boxes[name] = el ? boxOf(el) : null;
    }
    frames.push({ t, boxes });
  };
  const tick = () => {
    if (!on) return;
    painted.port2.postMessage(0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  (window as unknown as { __frames: { stop(): Frame[] } }).__frames = {
    stop() {
      on = false;
      painted.port1.close();
      return frames;
    },
  };
}
