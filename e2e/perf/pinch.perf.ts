import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, PHONE } from "../helpers";
import { mixedDoc } from "./large-docs";

// A phone's pinch on a long document, frame by frame: each gesturechange's
// own time, the layout it leaves to do (read back at once), scroll events
// and attribute changes it causes, and the frame gaps; then the landing.
// Asserts nothing about the numbers. Env: PINCH_BROWSER (webkit),
// PINCH_BLOCKS (1000), PINCH_DPR (3), PINCH_CPU_THROTTLE.

test.use({
  ...PHONE,
  browserName: (process.env.PINCH_BROWSER as "webkit") || "webkit",
  deviceScaleFactor: Number(process.env.PINCH_DPR) || 3,
});

const BLOCKS = Number(process.env.PINCH_BLOCKS) || 1000;

async function openLong(page: Page) {
  const doc = mixedDoc("zh", BLOCKS);
  await page.locator('[data-active-tab="true"] .ProseMirror').tap();
  await pasteMarkdown(page, doc.markdown);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("k_{999}", { timeout: 60_000 });
  await page.waitForTimeout(3000);
}

interface Scenario {
  name: string;
  /** Scroll position, as a share of the document. */
  at: number;
  scale: number;
  /** Pixels the fingers pan the page by during the pinch. */
  pan: number;
}
const SCENARIOS: Scenario[] = [
  { name: "top, in x2", at: 0, scale: 2, pan: 0 },
  { name: "middle, in x2", at: 0.5, scale: 2, pan: 0 },
  { name: "middle, in x2, pan 120", at: 0.5, scale: 2, pan: 120 },
  { name: "middle, out x0.5", at: 0.5, scale: 0.5, pan: 0 },
];

for (const scenario of SCENARIOS)
  test(`pinch frames: ${scenario.name}`, async ({ page, browserName }) => {
    test.setTimeout(5 * 60_000);
    // PINCH_CPU_THROTTLE=4 (Chromium): about a one-core, slow machine.
    const slow = Number(process.env.PINCH_CPU_THROTTLE);
    if (slow > 1 && browserName === "chromium") {
      const cpu = await page.context().newCDPSession(page);
      await cpu.send("Emulation.setCPUThrottlingRate", { rate: slow });
    }
    await page.route("http://asset.localhost/**", (route) =>
      route.fulfill({ status: 404 }),
    );
    await openApp(page, { settings: { language: "en" } });
    await openLong(page);
    await page.evaluate(async (at) => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-active-tab="true"] .editor-scroll',
      )!;
      scroller.scrollTop = scroller.scrollHeight * at;
      await new Promise((r) => setTimeout(r, 1500));
    }, scenario.at);
    await page.waitForTimeout(1500);
    console.log(scenario.name, JSON.stringify(await measure(page, scenario)));
  });

function measure(page: Page, scenario: Scenario) {
  return page.evaluate(async ({ scale, pan }) => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .editor-scroll',
    )!;
    const pm = scroller.querySelector<HTMLElement>(".ProseMirror")!;
    const box = pm.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: 300 };
    const pinch = (type: string, s: number) =>
      window.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), at, { scale: s }),
      );
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    // The character under the pinch, and how far it is drawn from there.
    const charAt = () => {
      const caret = document.caretRangeFromPoint(at.clientX, at.clientY)!;
      const range = document.createRange();
      const node = caret.startContainer;
      const end = (node.textContent ?? "").length;
      range.setStart(node, Math.min(caret.startOffset, end - 1));
      range.setEnd(node, Math.min(caret.startOffset, end - 1) + 1);
      const top = range.getBoundingClientRect().top;
      return () => Math.round(range.getBoundingClientRect().top - top);
    };
    let drift = charAt();
    let scrolls = 0;
    let mutations = 0;
    const touched = new Map<string, number>();
    document.addEventListener("scroll", () => scrolls++, true);
    new MutationObserver((list) => {
      for (const m of list) {
        mutations++;
        const el = m.target as Element;
        const key = `${el.nodeName}.${(el.className || "").toString().split(" ")[0]} ${m.attributeName ?? m.type}`;
        touched.set(key, (touched.get(key) ?? 0) + 1);
      }
    }).observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const handler: number[] = [];
    const layout: number[] = [];
    const gaps: number[] = [];
    const previewDrift: number[] = [];
    await frame();
    pinch("gesturestart", 1);
    let last = performance.now();
    const STEPS = 60;
    for (let i = 1; i <= STEPS; i++) {
      await frame();
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      const t0 = performance.now();
      if (pan) scroller.scrollTop += pan / STEPS;
      pinch("gesturechange", 1 + ((scale - 1) * i) / STEPS);
      const t1 = performance.now();
      void document.body.offsetHeight;
      handler.push(t1 - t0);
      layout.push(performance.now() - t1);
      previewDrift.push(drift());
    }
    const midScrolls = scrolls;
    const midMutations = mutations;
    const midTouched = [...touched].sort((a, b) => b[1] - a[1]).slice(0, 6);
    touched.clear();
    await frame();
    const beforeLanding = drift();
    // From here, the character the fingers see as the pinch ends.
    drift = charAt();
    const e0 = performance.now();
    pinch("gestureend", scale);
    const e1 = performance.now();
    const landed = drift();
    await frame();
    const e2 = performance.now();
    const after: number[] = [];
    const afterDrift: number[] = [];
    let prev = performance.now();
    for (let i = 0; i < 90; i++) {
      await frame();
      const now = performance.now();
      after.push(now - prev);
      afterDrift.push(drift());
      prev = now;
    }
    const pct = (v: number[], p: number) =>
      [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      scrollTop: Math.round(scroller.scrollTop),
      perChange: {
        handlerMax: r(Math.max(...handler)),
        layoutP50: r(pct(layout, 0.5)),
        layoutMax: r(Math.max(...layout)),
        gapP50: r(pct(gaps, 0.5)),
        gapMax: r(Math.max(...gaps)),
        scrolls: midScrolls,
        mutations: midMutations,
        touched: midTouched,
        driftMaxAbs: Math.max(...previewDrift.map(Math.abs)),
      },
      landing: {
        sync: r(e1 - e0),
        toFrame: r(e2 - e0),
        driftBefore: beforeLanding,
        driftLanded: landed,
        driftAfter: [...new Set(afterDrift)].slice(0, 10),
        afterGapMax: r(Math.max(...after)),
        afterTouched: [...touched].sort((a, b) => b[1] - a[1]).slice(0, 6),
      },
    };
  }, scenario);
}
