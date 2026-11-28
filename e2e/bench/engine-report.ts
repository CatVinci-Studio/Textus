import { existsSync, readFileSync } from "node:fs";
import type { Counters, Timing } from "./engine-meter";
import type { ProbeFrame } from "./engine-probe";
import type { TraceFrame, TraceSummary } from "./engine-trace";

/**
 * The engine benchmark's numbers: each run's frame distribution, the
 * trace's per-frame style and layout work, and the probe's per-frame
 * writes, reads, commits and observers - as JSON and as a console table.
 */

const DIST = process.env.BENCH_DIST ?? "node_modules/.cache/engine-bench-dist";
const BUDGET_60 = 1000 / 60;
const BUDGET_120 = 1000 / 120;

type Stats = { median: number; p95: number; max: number };

function stats(values: number[]): Stats {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { median: r(at(0.5)), p95: r(at(0.95)), max: r(s.at(-1) ?? 0) };
}

/** Frames that should have been drawn and weren't, at `budget`. */
const dropped = (intervals: number[], budget: number) =>
  intervals.reduce(
    (n, gap) => n + Math.max(0, Math.round(gap / budget - 0.4) - 1),
    0,
  );

const top = (m: Record<string, number>, n: number) =>
  Object.fromEntries(
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );

function add(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** A chunk's line named by the module it lies in (the build keeps a
 *  `// src/...` line before each). */
const chunks = new Map<string, string[]>();
function moduleAt(site: string): string {
  const m = /^(.*\.js):(\d+)$/.exec(site.split(" ").at(-1) ?? "");
  if (!m) return site;
  const file = `${DIST}/assets/${m[1]}`;
  if (!chunks.has(file))
    chunks.set(
      file,
      existsSync(file) ? readFileSync(file, "utf8").split("\n") : [],
    );
  const lines = chunks.get(file)!;
  for (let i = Number(m[2]) - 1; i >= 0; i--) {
    const region = /^\/\/ ((?:src|node_modules)\/\S+)$/.exec(lines[i] ?? "");
    if (region) return `${region[1]}+${Number(m[2]) - 1 - i}`;
  }
  return m[1]!;
}

function renamed(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) {
    const [head, ...rest] = k.split(" ");
    const key = rest.length
      ? `${head} ${moduleAt(rest.join(" "))}`
      : moduleAt(k);
    out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

function traceStats(trace: TraceSummary) {
  // Frames that did any rendering work: idle frames would hide the cost.
  const busy = trace.frames.filter((f) => f.styles || f.layouts);
  const pick = (k: keyof TraceFrame) => stats(busy.map((f) => f[k]));
  const main = busy.map((f) => f.scriptMs + f.styleMs + f.layoutMs + f.paintMs);
  return {
    frames: trace.frames.length,
    busyFrames: busy.length,
    styles: pick("styles"),
    layouts: pick("layouts"),
    forcedStyles: pick("forcedStyles"),
    forcedLayouts: pick("forcedLayouts"),
    forcedLayoutsTotal: busy.reduce((n, f) => n + f.forcedLayouts, 0),
    layoutsTotal: busy.reduce((n, f) => n + f.layouts, 0),
    layoutMs: pick("layoutMs"),
    styleMs: pick("styleMs"),
    paintMs: pick("paintMs"),
    scriptMs: pick("scriptMs"),
    mainMs: stats(main),
    over16: main.filter((ms) => ms > BUDGET_60).length,
    over8: main.filter((ms) => ms > BUDGET_120).length,
    invalidators: top(renamed(trace.invalidators), 8),
  };
}

function probeStats(frames: ProbeFrame[]) {
  const active = frames.filter(
    (f) => Object.keys(f.writes).length || f.commits || f.forced,
  );
  const writes: Record<string, number> = {};
  const reads: Record<string, number> = {};
  const rendered: Record<string, number> = {};
  const observers: Record<string, number> = {};
  const sites: Record<string, number> = {};
  for (const f of frames) {
    add(writes, f.writes);
    add(reads, f.reads);
    add(rendered, f.rendered);
    add(observers, f.observers);
    add(sites, f.sites);
  }
  const count = (m: Record<string, number>) =>
    Object.values(m).reduce((a, b) => a + b, 0);
  return {
    frames: frames.length,
    activeFrames: active.length,
    writesPerFrame: stats(active.map((f) => count(f.writes))),
    readsPerFrame: stats(active.map((f) => count(f.reads))),
    forcedPerFrame: stats(active.map((f) => f.forced)),
    forcedTotal: active.reduce((n, f) => n + f.forced, 0),
    commitsTotal: active.reduce((n, f) => n + f.commits, 0),
    framesWithCommit: active.filter((f) => f.commits).length,
    writes: top(writes, 14),
    reads: top(reads, 10),
    rendered: top(rendered, 12),
    observers: top(renamed(observers), 10),
    sites: top(renamed(sites), 12),
  };
}

export type GestureResult = ReturnType<typeof summarise>;

export function summarise(
  name: string,
  runs: {
    label: string;
    timing: Timing;
    counters: Counters | null;
    trace: TraceSummary | null;
  }[],
  probe: ProbeFrame[],
) {
  return {
    name,
    runs: runs.map(({ label, timing, counters, trace }) => ({
      label,
      frames: timing.intervals.length,
      interval: stats(timing.intervals),
      dropped60: dropped(timing.intervals, BUDGET_60),
      work: stats(timing.work),
      workOver16: timing.work.filter((ms) => ms > BUDGET_60).length,
      workOver8: timing.work.filter((ms) => ms > BUDGET_120).length,
      counters,
      trace: trace && traceStats(trace),
    })),
    probe: probeStats(probe),
  };
}

const f1 = (n: number) => n.toFixed(1);

export function formatEngine(results: GestureResult[]): string {
  const rows = results.flatMap((r) =>
    r.runs.map((run) => [
      r.name,
      run.label,
      String(run.frames),
      `${f1(run.interval.median)}/${f1(run.interval.p95)}/${f1(run.interval.max)}`,
      String(run.dropped60),
      `${f1(run.work.p95)}/${f1(run.work.max)}`,
      `${run.workOver16}/${run.workOver8}`,
      run.trace ? `${run.trace.layouts.median}/${run.trace.layouts.max}` : "-",
      run.trace
        ? `${run.trace.forcedLayoutsTotal}/${run.trace.layoutsTotal}`
        : "-",
      run.trace
        ? `${f1(run.trace.layoutMs.p95)}/${f1(run.trace.layoutMs.max)}`
        : "-",
      `${r.probe.writesPerFrame.median}/${r.probe.writesPerFrame.max}`,
      `${r.probe.forcedTotal}`,
      `${r.probe.commitsTotal}`,
    ]),
  );
  const head = [
    "gesture",
    "run",
    "frames",
    "interval med/p95/max",
    "dropped@60",
    "work p95/max",
    "work>16.7/>8.3",
    "layouts/frame med/max",
    "forced/all layouts",
    "layout ms p95/max",
    "writes/frame",
    "probe forced",
    "commits",
  ];
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const detail = results.map(
    (r) =>
      `${r.name}: writes ${JSON.stringify(r.probe.writes)}\n  reads ${JSON.stringify(r.probe.reads)}\n  observers ${JSON.stringify(r.probe.observers)}`,
  );
  return [line(head), ...rows.map(line), "", ...detail].join("\n");
}
