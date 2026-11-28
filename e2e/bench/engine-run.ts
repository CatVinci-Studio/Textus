import { mkdirSync, writeFileSync } from "node:fs";
import { test, type Browser, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { GESTURES, openHeavy, type Gesture } from "./engine-gestures";
import { timed, type Counters, type Timing } from "./engine-meter";
import { installEngineProbe, probeStart, probeStop } from "./engine-probe";
import { traceFrames, type TraceSummary } from "./engine-trace";
import { formatEngine, summarise } from "./engine-report";

/**
 * The engine benchmark's run, for one browser engine: each gesture timed
 * as it is and constrained, traced (Chromium), and probed frame by frame.
 * The app is the production build `scripts/bench-engine-build.mjs` makes,
 * served here. Not a test and not in CI: `npm run bench:engine`.
 */

const DIST = process.env.BENCH_DIST ?? "node_modules/.cache/engine-bench-dist";
const OUT = process.env.BENCH_OUT ?? "test-results/engine-bench";
const PORT = Number(process.env.BENCH_PORT ?? 1469);
/** CDP's CPU throttling for the constrained runs (Chromium). */
const SLOW = Number(process.env.BENCH_CPU ?? 4);
const ONLY = process.env.BENCH_GESTURES?.split(",");
/** Saves each raw Chromium trace beside the results. */
const KEEP_TRACES = process.env.BENCH_TRACE === "1";
/** Names a run made under constraints set from outside (a file name and
 *  the runs' label). */
const LABEL = process.env.BENCH_LABEL ?? "";

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "blink.user_timing",
  "v8.execute",
];

async function traced(
  browser: Browser,
  page: Page,
  name: string,
  act: () => Promise<void>,
): Promise<TraceSummary> {
  await browser.startTracing(page, { categories: CATEGORIES });
  await page.evaluate(() => performance.mark("engine-bench-start"));
  await act();
  await page.waitForTimeout(500);
  await page.evaluate(() => performance.mark("engine-bench-end"));
  const buffer = await browser.stopTracing();
  if (KEEP_TRACES) writeFileSync(`${OUT}/${name}.trace.json`, buffer);
  return traceFrames(JSON.parse(buffer.toString("utf8")));
}

async function probed(page: Page, act: () => Promise<void>) {
  await page.evaluate(probeStart);
  await act();
  await page.waitForTimeout(500);
  return page.evaluate(probeStop);
}

export function defineEngineBench(engine: "webkit" | "chromium") {
  let server: PreviewServer | null = null;

  test.use({ baseURL: `http://localhost:${PORT}` });

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    server = await preview({
      configFile: false,
      logLevel: "warn",
      build: { outDir: DIST },
      preview: { port: PORT, strictPort: true },
    });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  for (const gesture of GESTURES) {
    if (ONLY && !ONLY.includes(gesture.name)) continue;
    test(gesture.name, async ({ page, browser }) => {
      test.setTimeout(600_000);
      await openHeavy(page);
      await gesture.setup(page);
      const runs = await timeAndTrace(engine, gesture, page, browser);
      const context = page.context();
      await page.close();
      // The probe in a page of its own: its hooks cost time, which the
      // timed runs go without.
      const probePage = await context.newPage();
      await probePage.addInitScript(installEngineProbe);
      await openHeavy(probePage);
      await gesture.setup(probePage);
      await gesture.play(probePage);
      const frames = await probed(probePage, () => gesture.play(probePage));
      await probePage.close();
      // Kept a gesture at a time: one that fails costs only its own.
      const result = summarise(gesture.name, runs, frames);
      const name = [engine, LABEL, gesture.name].filter(Boolean).join("-");
      writeFileSync(
        `${OUT}/${name}.json`,
        JSON.stringify({ engine, slow: SLOW, ...result }, null, 2),
      );
      console.log(`\n${engine}\n${formatEngine([result])}\n`);
    });
  }
}

async function timeAndTrace(
  engine: "webkit" | "chromium",
  gesture: Gesture,
  page: Page,
  browser: Browser,
) {
  const act = () => gesture.play(page);
  // The first play loads and compiles its code: not its motion.
  await act();
  const runs: {
    label: string;
    timing: Timing;
    counters: Counters | null;
    trace: TraceSummary | null;
  }[] = [];
  const cdp =
    engine === "chromium" ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const throttles = cdp ? [1, SLOW] : [1];
  for (const cpu of throttles) {
    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const { timing, counters } = await timed(page, cdp, act);
    const trace = cdp
      ? await traced(browser, page, `${gesture.name}-cpu${cpu}`, act)
      : null;
    runs.push({ label: LABEL || `cpu x${cpu}`, timing, counters, trace });
  }
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return runs;
}
