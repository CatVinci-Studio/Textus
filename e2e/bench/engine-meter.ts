import type { CDPSession, Page } from "@playwright/test";

/**
 * The engine benchmark's frame clock, the same in every engine: each
 * animation frame's interval, and an estimate of its main-thread work - the
 * frame's time stamp to a message posted from its animation-frame
 * callback, which runs once that frame's style, layout and paint are done.
 */

export interface Timing {
  intervals: number[];
  work: number[];
}

/** Runs in the page. */
function timingStart() {
  const sink = { on: true, stamps: [] as number[], work: [] as number[] };
  (window as unknown as { __timing: typeof sink }).__timing = sink;
  const tick = (t: number) => {
    if (!sink.on) return;
    sink.stamps.push(t);
    const channel = new MessageChannel();
    channel.port1.onmessage = () => sink.work.push(performance.now() - t);
    channel.port2.postMessage(null);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Runs in the page. */
function timingStop(): Timing {
  const sink = (
    window as unknown as {
      __timing: { on: boolean; stamps: number[]; work: number[] };
    }
  ).__timing;
  sink.on = false;
  return {
    intervals: sink.stamps.slice(1).map((t, i) => t - sink.stamps[i]!),
    work: sink.work,
  };
}

/** Chromium's own layout and style counters over a span. */
export type Counters = Record<
  "layouts" | "styleRecalcs" | "layoutMs" | "styleMs" | "scriptMs",
  number
>;

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** Plays `act` with the frame clock on (and Chromium's counters when
 *  `cdp` is given), then `settleMs` more for the motion it started. */
export async function timed(
  page: Page,
  cdp: CDPSession | null,
  act: () => Promise<void>,
  settleMs = 500,
): Promise<{ timing: Timing; counters: Counters | null }> {
  const before = cdp ? await metrics(cdp) : null;
  await page.evaluate(timingStart);
  await act();
  await page.waitForTimeout(settleMs);
  const timing = await page.evaluate(timingStop);
  if (!cdp || !before) return { timing, counters: null };
  const after = await metrics(cdp);
  const d = (k: string) => (after[k] ?? 0) - (before[k] ?? 0);
  return {
    timing,
    counters: {
      layouts: d("LayoutCount"),
      styleRecalcs: d("RecalcStyleCount"),
      layoutMs: d("LayoutDuration") * 1000,
      styleMs: d("RecalcStyleDuration") * 1000,
      scriptMs: d("ScriptDuration") * 1000,
    },
  };
}
