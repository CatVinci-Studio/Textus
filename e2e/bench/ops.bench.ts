import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test, type Page } from "@playwright/test";
import { SAMPLE_DOC, openApp } from "../helpers";

/**
 * Everyday operations timed on a slowed machine (BENCH_CPU, default 6):
 * the window coming up, a document opening, a key reaching the screen,
 * a long scroll, and what the window costs while nobody touches it.
 * `npx playwright test -c playwright.weak.config.ts ops`.
 */

const CPU = Number(process.env.BENCH_CPU ?? 6);
const OUT = process.env.BENCH_OUT ?? "test-results/ops-bench.json";
const LONG = Array.from({ length: 12 }, () => SAMPLE_DOC).join("\n\n");
const results: Record<string, number> = {};

/** The CPU slowed from the start; the network only once the window is up:
 *  the dev server's hundreds of modules would make a slow network the
 *  whole of the startup, which the app, read from disk, never pays. */
async function slow(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  return cdp;
}

async function slowNetwork(cdp: Awaited<ReturnType<typeof slow>>) {
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

/** Milliseconds from a key's press to the frame that shows it, median. */
async function keyLatency(page: Page, keys: number) {
  const times: number[] = [];
  for (let i = 0; i < keys; i++) {
    const t = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const start = performance.now();
          const target = document.activeElement!;
          target.dispatchEvent(
            new InputEvent("beforeinput", {
              inputType: "insertText",
              data: "a",
              bubbles: true,
              cancelable: true,
            }),
          );
          document.execCommand("insertText", false, "a");
          requestAnimationFrame(() =>
            setTimeout(() => done(performance.now() - start)),
          );
        }),
    );
    times.push(t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

test("everyday operations on a weak machine", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript((text) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/long.md": text,
      "/work/short.md": "# Short\n\nA few words.\n",
    };
  }, LONG);
  const cdp = await slow(page);

  const start = Date.now();
  await openApp(page, { settings: { language: "en" } });
  results.startupMs = Date.now() - start;
  await slowNetwork(cdp);

  const open = async (path: string, heading: string) => {
    const t0 = Date.now();
    await page.evaluate(
      (p) =>
        window.dispatchEvent(
          new CustomEvent("textus:open-file-in-tab", { detail: { path: p } }),
        ),
      path,
    );
    await page.waitForFunction(
      (h) =>
        document
          .querySelector('[data-active-tab="true"] .ProseMirror h1')
          ?.textContent?.includes(h),
      heading,
    );
    return Date.now() - t0;
  };
  results.openShortMs = await open("/work/short.md", "Short");
  results.openLongMs = await open("/work/long.md", "老城区");

  await page.locator('[data-active-tab="true"] .ProseMirror p').first().click();
  results.keyLatencyMs = await keyLatency(page, 15);

  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  const t1 = Date.now();
  for (let i = 0; i < 20; i++) {
    await scroller.evaluate((el) => el.scrollBy(0, 600));
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
  }
  results.scroll20FramesMs = Date.now() - t1;

  await cdp.send("Performance.enable");
  const before = (await cdp.send("Performance.getMetrics")).metrics;
  await page.waitForTimeout(5000);
  const after = (await cdp.send("Performance.getMetrics")).metrics;
  const get = (m: { name: string; value: number }[], n: string) =>
    m.find((x) => x.name === n)?.value ?? 0;
  results.idleScriptMsPer5s =
    (get(after, "ScriptDuration") - get(before, "ScriptDuration")) * 1000;
  results.idleLayoutsPer5s =
    get(after, "LayoutCount") - get(before, "LayoutCount");
  results.idleStyleRecalcsPer5s =
    get(after, "RecalcStyleCount") - get(before, "RecalcStyleCount");
  results.heapMB = get(after, "JSHeapUsedSize") / 1024 / 1024;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ cpu: CPU, ...results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
});
