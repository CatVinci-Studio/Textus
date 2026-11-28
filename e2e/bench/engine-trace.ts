/**
 * A Chromium trace read frame by frame for the engine benchmark: on the
 * page's main thread, between the bench's two marks, how many style
 * recalcs, layouts and paints each frame ran and for how long, how many of
 * them were forced (run inside script, a read after a write), and who
 * invalidated layout (the stack the trace keeps with each invalidation).
 */

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: {
    name?: string;
    data?: {
      stackTrace?: { url: string; lineNumber: number; functionName: string }[];
    };
    beginData?: {
      stackTrace?: { url: string; lineNumber: number; functionName: string }[];
    };
  };
}

export interface TraceFrame {
  ms: number;
  styles: number;
  layouts: number;
  forcedStyles: number;
  forcedLayouts: number;
  paints: number;
  styleMs: number;
  layoutMs: number;
  paintMs: number;
  scriptMs: number;
}

export interface TraceSummary {
  frames: TraceFrame[];
  /** "function url:line" of what invalidated layout -> times. */
  invalidators: Record<string, number>;
}

const STYLE = new Set(["UpdateLayoutTree", "RecalculateStyles"]);
const LAYOUT = new Set(["Layout"]);
const PAINT = new Set(["Paint", "PrePaint", "Layerize", "Commit"]);
/** Script entry points: style or layout inside one was forced. */
const SCRIPT = new Set([
  "FunctionCall",
  "FireAnimationFrame",
  "EventDispatch",
  "TimerFire",
  "RunMicrotasks",
  "FireIdleCallback",
  "v8.callFunction",
  "V8.Execute",
  "EvaluateScript",
]);
/** What opens a frame on the main thread. */
const FRAME_START = new Set(["BeginMainThreadFrame", "BeginFrame"]);

export function traceFrames(raw: unknown): TraceSummary {
  const events: TraceEvent[] = Array.isArray(raw)
    ? raw
    : ((raw as { traceEvents: TraceEvent[] }).traceEvents ?? []);
  const start = events.find((e) => e.name === "engine-bench-start");
  const end = events.find((e) => e.name === "engine-bench-end");
  const main = events.find(
    (e) =>
      e.ph === "M" &&
      e.name === "thread_name" &&
      e.args?.name === "CrRendererMain" &&
      (!start || e.pid === start.pid),
  );
  if (!main) return { frames: [], invalidators: {} };
  const from = start?.ts ?? -Infinity;
  const to = end?.ts ?? Infinity;
  const mine = events
    .filter(
      (e) =>
        e.pid === main.pid && e.tid === main.tid && e.ts >= from && e.ts <= to,
    )
    .sort((a, b) => a.ts - b.ts);
  const spans = completeSpans(mine);
  const scripts = spans.filter((s) => SCRIPT.has(s.name));
  const inScript = (s: Span) =>
    scripts.some(
      (p) => p !== s && p.ts <= s.ts && p.ts + p.dur >= s.ts + s.dur,
    );
  const starts = mine
    .filter((e) => FRAME_START.has(e.name))
    .map((e) => e.ts)
    .filter((t, i, all) => i === 0 || t - all[i - 1]! > 1000);
  const frames: TraceFrame[] = starts.map((t, i) => ({
    ms: ((starts[i + 1] ?? to) - t) / 1000,
    styles: 0,
    layouts: 0,
    forcedStyles: 0,
    forcedLayouts: 0,
    paints: 0,
    styleMs: 0,
    layoutMs: 0,
    paintMs: 0,
    scriptMs: 0,
  }));
  const frameOf = (ts: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    if (hi < 0 || ts < starts[0]!) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= ts) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo]!;
  };
  const topScripts = scripts.filter((s) => !inScript(s));
  for (const s of spans) {
    const f = frameOf(s.ts);
    if (!f) continue;
    const ms = s.dur / 1000;
    if (STYLE.has(s.name)) {
      f.styles++;
      f.styleMs += ms;
      if (inScript(s)) f.forcedStyles++;
    } else if (LAYOUT.has(s.name)) {
      f.layouts++;
      f.layoutMs += ms;
      if (inScript(s)) f.forcedLayouts++;
    } else if (PAINT.has(s.name)) {
      f.paints++;
      f.paintMs += ms;
    } else if (topScripts.includes(s)) f.scriptMs += ms;
  }
  const invalidators: Record<string, number> = {};
  for (const e of mine) {
    if (
      e.name !== "InvalidateLayout" &&
      e.name !== "ScheduleStyleRecalculation"
    )
      continue;
    const top = (e.args?.data?.stackTrace ??
      e.args?.beginData?.stackTrace)?.[0];
    if (!top) continue;
    const key = `${e.name === "InvalidateLayout" ? "layout" : "style"} ${top.functionName || "?"} ${top.url.replace(/^.*\/assets\//, "")}:${top.lineNumber + 1}`;
    invalidators[key] = (invalidators[key] ?? 0) + 1;
  }
  return { frames, invalidators };
}

interface Span {
  name: string;
  ts: number;
  dur: number;
}

/** Complete events as they are; begin/end pairs joined. */
function completeSpans(events: TraceEvent[]): Span[] {
  const out: Span[] = [];
  const open = new Map<string, TraceEvent[]>();
  for (const e of events) {
    if (e.ph === "X") out.push({ name: e.name, ts: e.ts, dur: e.dur ?? 0 });
    else if (e.ph === "B") {
      const list = open.get(e.name) ?? [];
      list.push(e);
      open.set(e.name, list);
    } else if (e.ph === "E") {
      const b = open.get(e.name)?.pop();
      if (b) out.push({ name: e.name, ts: b.ts, dur: e.ts - b.ts });
    }
  }
  return out;
}
