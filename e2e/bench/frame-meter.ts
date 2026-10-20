import type { CDPSession, Page } from "@playwright/test";

/**
 * Frame timing for the motion benchmark (motion.bench.ts): a
 * requestAnimationFrame loop that records every frame's interval, the
 * long tasks and long animation frames Chromium reports (the latter with
 * the time scripts spent forcing style and layout), and the engine's own
 * layout and style counters (CDP Performance.getMetrics) over the same
 * span.
 */

export interface FrameReport {
  name: string;
  ms: number;
  frames: number;
  /** Frames that should have been painted and weren't: an interval of
   *  2.4 frame budgets is one missed frame, of 3.4 two, and so on. */
  dropped: number;
  p95: number;
  worst: number;
  longTasks: number;
  longTaskMs: number;
  /** Time scripts in long animation frames spent in forced style and
   *  layout: a read after a write. */
  forcedLayoutMs: number;
  layouts: number;
  styleRecalcs: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
  /** The scripts that took longest in long animation frames, heaviest
   *  first: who to blame for a dropped frame. */
  culprits: { script: string; ms: number; forcedLayoutMs: number }[];
}

const BUDGET = 1000 / 60;

type Metrics = Record<string, number>;

async function metrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

export class FrameMeter {
  private constructor(
    private page: Page,
    private cdp: CDPSession,
  ) {}

  /** `cpu`: CDP's CPU throttling rate, 1 for none. WebKitGTK on a laptop
   *  runs this app at roughly what Chromium does slowed four times. */
  static async attach(page: Page, cpu: number): Promise<FrameMeter> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    if (cpu > 1)
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    return new FrameMeter(page, cdp);
  }

  /** Runs `action` with the meter on, then lets `settleMs` of frames go
   *  by so the motion it started is measured to its end. */
  async measure(
    name: string,
    action: () => Promise<void>,
    settleMs = 400,
  ): Promise<FrameReport> {
    await this.page.evaluate(() => {
      type Sink = {
        frames: number[];
        long: number[];
        forced: number;
        scripts: Record<string, { ms: number; forced: number }>;
        on: boolean;
        observers: PerformanceObserver[];
      };
      const sink: Sink = {
        frames: [],
        long: [],
        forced: 0,
        scripts: {},
        on: true,
        observers: [],
      };
      (window as unknown as { __meter: Sink }).__meter = sink;
      const tick = (t: number) => {
        if (!sink.on) return;
        sink.frames.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const observe = (type: string, take: (e: PerformanceEntry) => void) => {
        try {
          const o = new PerformanceObserver((list) =>
            list.getEntries().forEach(take),
          );
          o.observe({ type, buffered: false });
          sink.observers.push(o);
        } catch {
          // Not in this engine.
        }
      };
      observe("longtask", (e) => sink.long.push(e.duration));
      observe("long-animation-frame", (e) => {
        const scripts =
          (
            e as unknown as {
              scripts?: {
                duration: number;
                forcedStyleAndLayoutDuration: number;
                invoker: string;
                sourceURL: string;
                sourceFunctionName: string;
                sourceCharPosition: number;
              }[];
            }
          ).scripts ?? [];
        for (const s of scripts) {
          sink.forced += s.forcedStyleAndLayoutDuration;
          const file = s.sourceURL.replace(/^.*\/(src|node_modules)\//, "$1/");
          const key = `${s.invoker} ${s.sourceFunctionName || "?"} ${file.split("?")[0]}`;
          const seen = sink.scripts[key] ?? { ms: 0, forced: 0 };
          seen.ms += s.duration;
          seen.forced += s.forcedStyleAndLayoutDuration;
          sink.scripts[key] = seen;
        }
      });
    });
    const before = await metrics(this.cdp);
    const start = Date.now();
    await action();
    await this.page.waitForTimeout(settleMs);
    const ms = Date.now() - start;
    const after = await metrics(this.cdp);
    const raw = await this.page.evaluate(() => {
      const sink = (
        window as unknown as {
          __meter: {
            frames: number[];
            long: number[];
            forced: number;
            scripts: Record<string, { ms: number; forced: number }>;
            on: boolean;
            observers: PerformanceObserver[];
          };
        }
      ).__meter;
      sink.on = false;
      for (const o of sink.observers) o.disconnect();
      return {
        frames: sink.frames,
        long: sink.long,
        forced: sink.forced,
        scripts: sink.scripts,
      };
    });
    const intervals = raw.frames.slice(1).map((t, i) => t - raw.frames[i]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const delta = (key: string) => (after[key] ?? 0) - (before[key] ?? 0);
    return {
      name,
      ms,
      frames: intervals.length,
      dropped: intervals.reduce(
        (sum, gap) => sum + Math.max(0, Math.round(gap / BUDGET - 0.4) - 1),
        0,
      ),
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worst: sorted.at(-1) ?? 0,
      longTasks: raw.long.length,
      longTaskMs: raw.long.reduce((a, b) => a + b, 0),
      forcedLayoutMs: raw.forced,
      layouts: delta("LayoutCount"),
      styleRecalcs: delta("RecalcStyleCount"),
      layoutMs: delta("LayoutDuration") * 1000,
      styleMs: delta("RecalcStyleDuration") * 1000,
      scriptMs: delta("ScriptDuration") * 1000,
      culprits: Object.entries(raw.scripts)
        .map(([script, { ms, forced }]) => ({
          script,
          ms,
          forcedLayoutMs: forced,
        }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5),
    };
  }
}

/** The reports as one table, for the console. */
export function formatReports(reports: FrameReport[]): string {
  const head = [
    "scenario",
    "ms",
    "frames",
    "dropped",
    "p95",
    "worst",
    "longTasks",
    "forcedLayout",
    "layouts",
    "layoutMs",
    "styleMs",
    "scriptMs",
  ];
  const rows = reports.map((r) => [
    r.name,
    String(r.ms),
    String(r.frames),
    String(r.dropped),
    r.p95.toFixed(1),
    r.worst.toFixed(1),
    `${r.longTasks} (${r.longTaskMs.toFixed(0)}ms)`,
    r.forcedLayoutMs.toFixed(1),
    String(r.layouts),
    r.layoutMs.toFixed(1),
    r.styleMs.toFixed(1),
    r.scriptMs.toFixed(1),
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join("  ");
  const blame = reports
    .filter((r) => r.culprits.length > 0)
    .map(
      (r) =>
        `${r.name}:\n${r.culprits
          .map(
            (c) =>
              `  ${c.ms.toFixed(0).padStart(5)}ms (forced layout ${c.forcedLayoutMs.toFixed(0)}ms)  ${c.script}`,
          )
          .join("\n")}`,
    );
  return [line(head), ...rows.map(line), "", ...blame].join("\n");
}
