import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";
import { mixedDoc, plainDoc, type LargeDoc } from "./large-docs";

// The large-document benchmark: measures opening, memory, typing, scrolling,
// saving and tab switching per generated document. Asserts nothing about the
// numbers. Env: PERF_DOCS, PERF_CHARS (default 200), PERF_LABEL.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

// zh-1k is about 50,000 characters, zh-8k about 500,000; the larger ones
// show what grows with length.
const ALL: (() => LargeDoc)[] = [
  () => mixedDoc("zh", 1000),
  () => mixedDoc("zh", 5000),
  () => mixedDoc("en", 5000),
  () => mixedDoc("zh", 8000),
  () => mixedDoc("zh", 20000),
  () => plainDoc(200_000),
];
const only = process.env.PERF_DOCS?.split(",").map((s) => s.trim());
const CHARS = Number(process.env.PERF_CHARS) || 200;

// A 1x1 PNG for every local image the documents name.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const editor = '[data-active-tab="true"] .ProseMirror';

/** What the page keeps while it is measured (installed before load). */
function installProbes() {
  type Stats = Record<string, { ms: number; calls: number }>;
  const w = window as unknown as Record<string, unknown>;
  const longTasks: { start: number; duration: number }[] = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // Not Chromium: no long tasks to count.
  }
  // Input to the frame after it: the beforeinput's own time stamp to a
  // message posted from the next animation frame, which runs once that
  // frame's style, layout and paint are queued.
  const latencies: number[] = [];
  let pending: Promise<void> = Promise.resolve();
  const measure = (event: Event) => {
    const stamp = event.timeStamp;
    pending = new Promise((resolve) =>
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          latencies.push(performance.now() - stamp);
          resolve();
        };
        channel.port2.postMessage(null);
      }),
    );
  };
  window.addEventListener("beforeinput", measure, true);
  // ProseMirror takes Enter at keydown, and the browser sends no input.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") measure(event);
    },
    true,
  );
  const plugins: Stats = {};
  const perDispatch: { total: number; plugins: number }[] = [];
  let pluginMs = 0;
  w.__bench = {
    longTasks,
    latencies,
    plugins,
    perDispatch,
    settled: () => pending,
    /** Times every plugin's state.apply, decorations, appendTransaction
     *  and view update, and each dispatch as a whole. */
    instrument() {
      type View = {
        state: {
          plugins: {
            key: string;
            spec: Record<string, unknown>;
            props: Record<string, unknown>;
          }[];
          config: {
            fields: { name: string; apply: (...a: unknown[]) => unknown }[];
          };
        };
        directPlugins: { key: string; spec: Record<string, unknown> }[];
        pluginViews: { update?: (...a: unknown[]) => unknown }[];
        dispatch: (tr: unknown) => void;
      };
      const view = w.__pmView as View;
      const add = (name: string, ms: number) => {
        const s = (plugins[name] ??= { ms: 0, calls: 0 });
        s.ms += ms;
        s.calls++;
        pluginMs += ms;
      };
      const timed = <F extends (...a: unknown[]) => unknown>(
        name: string,
        fn: F,
      ) =>
        function (this: unknown, ...args: unknown[]) {
          const t = performance.now();
          try {
            return fn.apply(this, args);
          } finally {
            add(name, performance.now() - t);
          }
        };
      // A state's fields keep the apply bound when its configuration was
      // made; every later state shares that configuration.
      for (const field of view.state.config.fields)
        field.apply = timed(`${field.name} apply`, field.apply);
      for (const plugin of view.state.plugins) {
        const deco = plugin.props.decorations as
          ((...a: unknown[]) => unknown) | undefined;
        if (deco) plugin.props.decorations = timed(`${plugin.key} deco`, deco);
        const append = plugin.spec.appendTransaction as
          ((...a: unknown[]) => unknown) | undefined;
        if (append)
          plugin.spec.appendTransaction = timed(`${plugin.key} append`, append);
      }
      const withViews = [...view.directPlugins, ...view.state.plugins].filter(
        (p) => p.spec.view,
      );
      view.pluginViews.forEach((pv, i) => {
        if (pv.update)
          pv.update = timed(`${withViews[i]?.key ?? i} view`, pv.update);
      });
      const dispatch = view.dispatch;
      view.dispatch = function (tr) {
        const before = pluginMs;
        const t = performance.now();
        dispatch.call(this, tr);
        perDispatch.push({
          total: performance.now() - t,
          plugins: pluginMs - before,
        });
      };
    },
  };
}

interface Bench {
  longTasks: { start: number; duration: number }[];
  latencies: number[];
  plugins: Record<string, { ms: number; calls: number }>;
  perDispatch: { total: number; plugins: number }[];
  settled: () => Promise<void>;
  instrument: () => void;
}
type BenchWindow = Window & { __bench: Bench };

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
const r1 = (n: number) => Math.round(n * 10) / 10;

async function openDoc(page: Page, doc: LargeDoc, path: string) {
  return page.evaluate(
    async ({ path, markdown, firstText }) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = { [path]: markdown };
      const start = performance.now();
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
      // Visible: the document's first heading drawn in the active editor.
      await new Promise<void>((resolve) => {
        const look = () => {
          const el = document.querySelector(
            '[data-active-tab="true"] .ProseMirror',
          );
          if (el?.textContent?.includes(firstText)) resolve();
          else requestAnimationFrame(look);
        };
        look();
      });
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      const visible = performance.now() - start;
      // Ready: no long task for a full second (the end of the last one).
      const { longTasks } = (window as unknown as BenchWindow).__bench;
      const quietSince = () => {
        const last = longTasks.filter((t) => t.start >= start).at(-1);
        return last ? last.start + last.duration : start + visible;
      };
      while (performance.now() - quietSince() < 1000)
        await new Promise((r) => setTimeout(r, 100));
      const heap = (
        performance as unknown as { memory?: { usedJSHeapSize: number } }
      ).memory?.usedJSHeapSize;
      return {
        visible,
        ready: quietSince() - start,
        heapMB: heap ? heap / 1048576 : null,
      };
    },
    { path, markdown: doc.markdown, firstText: firstLine(doc) },
  );
}

/** What the page holds once garbage is collected: the JS heap, the DOM
 *  nodes and the layout objects the renderer keeps for them (Chromium's
 *  DevTools protocol; null elsewhere). */
async function memory(page: Page, browserName: string) {
  if (browserName !== "chromium") return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  const get = (name: string) =>
    metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    heapMB: Math.round(get("JSHeapUsedSize") / 1048576),
    nodes: get("Nodes"),
    layoutObjects: get("LayoutObjects"),
  };
}

function firstLine(doc: LargeDoc): string {
  return doc.markdown.split("\n")[0].replace(/^#+ /, "");
}

/** The caret at the end of a paragraph in the middle of the document. */
async function caretToMiddle(page: Page) {
  await page.evaluate(() => {
    type PMNode = {
      childCount: number;
      child: (i: number) => PMNode;
      nodeSize: number;
      type: { name: string };
      textContent: string;
    };
    const view = (window as unknown as Record<string, unknown>).__pmView as {
      state: {
        doc: PMNode;
        tr: {
          setSelection: (s: unknown) => unknown;
          scrollIntoView: () => unknown;
        };
        selection: { constructor: { near: (p: unknown) => unknown } };
      };
      dispatch: (tr: unknown) => void;
      focus: () => void;
    };
    const { doc } = view.state;
    let pos = 0;
    const middle = Math.floor(doc.childCount / 2);
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      if (i >= middle && child.type.name === "paragraph" && child.textContent) {
        pos += child.nodeSize - 1;
        break;
      }
      pos += child.nodeSize;
    }
    // TextSelection isn't reachable from here; Selection.near of a
    // resolved position inside a paragraph is one.
    const $pos = (
      doc as unknown as { resolve: (p: number) => unknown }
    ).resolve(pos);
    const tr = view.state.tr.setSelection(
      view.state.selection.constructor.near($pos),
    ) as { scrollIntoView: () => unknown };
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
  await page.waitForTimeout(500);
}

async function typeInMiddle(page: Page, doc: LargeDoc) {
  await caretToMiddle(page);
  await page.evaluate(() => {
    const b = (window as unknown as BenchWindow).__bench;
    b.instrument();
    b.latencies.length = 0;
    b.perDispatch.length = 0;
    for (const k of Object.keys(b.plugins)) delete b.plugins[k];
  });
  const start = await page.evaluate(() => performance.now());
  const text = doc.name.startsWith("en")
    ? "the quick brown fox jumps over the lazy dog "
    : "大文档里打字应该和小文档一样流畅";
  for (let i = 0; i < CHARS; i++) {
    await page.keyboard.type(text[i % text.length]);
    await page.evaluate(() =>
      (window as unknown as BenchWindow).__bench.settled(),
    );
    // About a fast typist's pace: the editor's own timers (debounced
    // reports, previews) get to run between keys, as they would.
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);
  return page.evaluate((start) => {
    const b = (window as unknown as BenchWindow).__bench;
    const tasks = b.longTasks.filter((t) => t.start >= start);
    return {
      latencies: [...b.latencies],
      dispatch: b.perDispatch.map((d) => d.total),
      plugins: b.perDispatch.map((d) => d.plugins),
      byPlugin: { ...b.plugins },
      longTasks: tasks.map((t) => t.duration),
    };
  }, start);
}

/** Enter pressed in the middle: a new block, which the browser lays out
 *  in place of the old one (unlike a character typed into a line). */
async function pressEnter(page: Page, count: number) {
  await page.evaluate(() => {
    (window as unknown as BenchWindow).__bench.latencies.length = 0;
  });
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Enter");
    await page.evaluate(() =>
      (window as unknown as BenchWindow).__bench.settled(),
    );
    await page.waitForTimeout(100);
  }
  return page.evaluate(() => [
    ...(window as unknown as BenchWindow).__bench.latencies,
  ]);
}

/** Chinese committed through an input method: a composition, then its
 *  commit (Chromium's Input.imeSetComposition and Input.insertText). */
async function typeWithIme(page: Page, count: number) {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    const b = (window as unknown as BenchWindow).__bench;
    b.latencies.length = 0;
  });
  for (let i = 0; i < count; i++) {
    await cdp.send("Input.imeSetComposition", {
      text: "zhong",
      selectionStart: 5,
      selectionEnd: 5,
    });
    await cdp.send("Input.insertText", { text: "中" });
    await page.evaluate(() =>
      (window as unknown as BenchWindow).__bench.settled(),
    );
    await page.waitForTimeout(60);
  }
  await cdp.detach();
  return page.evaluate(() => [
    ...(window as unknown as BenchWindow).__bench.latencies,
  ]);
}

async function scrollThrough(page: Page) {
  return page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] > .editor-scroll',
    )!;
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    const frames: number[] = [];
    let last = performance.now();
    const step = Math.max(200, scroller.clientHeight * 0.4);
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        const before = scroller.scrollTop;
        scroller.scrollTop += step;
        if (scroller.scrollTop === before || frames.length > 3000) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return frames.slice(1);
  });
}

/** Puts the caret in the last heading and scrolls it to the top, as the
 *  outline does, and waits for it to stay put. */
async function jumpToEnd(page: Page) {
  return page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] > .editor-scroll',
    )!;
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    type PMNode = {
      type: { name: string };
      nodeSize: number;
      forEach: (f: (node: PMNode, pos: number) => void) => void;
      resolve: (pos: number) => unknown;
    };
    const view = (window as unknown as Record<string, unknown>).__pmView as {
      state: {
        doc: PMNode;
        tr: { setSelection: (s: unknown) => { scrollIntoView: () => unknown } };
        selection: { constructor: { near: (p: unknown) => unknown } };
      };
      dispatch: (tr: unknown) => void;
      domAtPos: (pos: number) => { node: Node };
    };
    const { doc } = view.state;
    let last = 0;
    doc.forEach((node, pos) => {
      if (node.type.name === "heading") last = pos + 1;
    });
    const start = performance.now();
    view.dispatch(
      view.state.tr
        .setSelection(view.state.selection.constructor.near(doc.resolve(last)))
        .scrollIntoView(),
    );
    // Drawn now it holds the caret; scrolled to as the outline does
    // (ProseMirror's own scrollIntoView doesn't move this scroller).
    const at = view.domAtPos(last).node;
    const heading = (at instanceof Element ? at : at.parentElement)!;
    heading.scrollIntoView({ block: "start" });
    let top = heading.getBoundingClientRect().top;
    let stable = 0;
    await new Promise((r) => requestAnimationFrame(r));
    let settledAt = performance.now();
    while (stable < 3 && performance.now() - start < 3000) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = heading.isConnected
        ? heading.getBoundingClientRect().top
        : top + 1;
      if (Math.abs(now - top) < 1) stable++;
      else {
        stable = 0;
        settledAt = performance.now();
      }
      top = now;
    }
    return { ms: settledAt - start, top };
  });
}

/** Ctrl+Tab between it and a small document: the time until the large one
 *  is drawn in front again, which lays it out anew (back tabs are hidden). */
async function switchTabs(page: Page, count: number) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    (w.__devFiles as Record<string, string>)["/bench/small.md"] =
      "# Small\n\nA short note.\n";
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/bench/small.md"],
      position: { x: 0, y: 0 },
    });
  });
  await expect(page.locator(editor)).toContainText("A short note.");
  const times: number[] = [];
  for (let i = 0; i < count * 2; i++) {
    const toLarge = i % 2 === 0;
    // Ctrl+Tab sent from the page (no round trip in the time), as many
    // times as it takes; the last one is timed.
    const ms = await page.evaluate(async (toLarge) => {
      const front = () =>
        document.querySelector('[data-active-tab="true"] .ProseMirror')
          ?.textContent ?? "";
      const there = () => front().includes("A short note.") !== toLarge;
      for (let tries = 0; tries < 4; tries++) {
        const start = performance.now();
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            code: "Tab",
            ctrlKey: true,
            bubbles: true,
          }),
        );
        while (!there() && performance.now() - start < 2000)
          await new Promise((r) => requestAnimationFrame(r));
        if (!there()) continue;
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
        return performance.now() - start;
      }
      throw new Error("Ctrl+Tab never brought the tab to the front");
    }, toLarge);
    if (toLarge) times.push(ms);
    await page.waitForTimeout(300);
  }
  return times;
}

/** One character typed, then at once File > Save, to the write reaching
 *  "disk": the save serializes what the debounced report hasn't yet. */
async function saveAfterEdit(page: Page, path: string) {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(400);
    await page.keyboard.type("x");
    times.push(
      await page.evaluate(async (path) => {
        const w = window as unknown as Record<string, unknown> & {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
          };
          __devEmitTauriEvent: (name: string) => void;
        };
        const original = w.__TAURI_INTERNALS__.invoke;
        const start = performance.now();
        const written = new Promise<number>((resolve) => {
          w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
            if (cmd === "write_text_file" && args.path === path) {
              resolve(performance.now() - start);
              return Promise.resolve(null);
            }
            if (cmd === "file_mtime_ms" && args.path === path)
              return Promise.resolve(1);
            return original(cmd, args);
          };
        });
        w.__devEmitTauriEvent("menu-save-file");
        const ms = await written;
        w.__TAURI_INTERNALS__.invoke = original;
        return ms;
      }, path),
    );
  }
  return times;
}

const docs = ALL.map((make) => make()).filter(
  (doc) => !only || only.includes(doc.name),
);

test.beforeAll(() => {
  const dir = join(here, "fixtures");
  mkdirSync(dir, { recursive: true });
  for (const doc of docs)
    writeFileSync(join(dir, `${doc.name}.md`), doc.markdown);
});

for (const doc of docs) {
  test(`large document: ${doc.name}`, async ({ page, browserName }) => {
    test.setTimeout(15 * 60_000);
    await page.route("http://asset.localhost/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PNG }),
    );
    await page.addInitScript(installProbes);
    // Tabs, not windows: the tab switch below needs two in one window.
    await openApp(page, {
      settings: { language: "en", newDocumentMode: "tab" },
    });
    const path = `/bench/${doc.name}.md`;

    const open = await openDoc(page, doc, path);
    // Opened whole: the end is in the document (a long one draws only the
    // blocks near the screen).
    await expect
      .poll(() =>
        page.evaluate(
          (text) =>
            (
              (window as unknown as Record<string, unknown>).__pmView as {
                state: { doc: { textContent: string } };
              }
            ).state.doc.textContent.includes(text),
          doc.lastHeading,
        ),
      )
      .toBe(true);
    const opened = await memory(page, browserName);

    const typing = await typeInMiddle(page, doc);
    // Chromium only: the composition is sent through its DevTools protocol.
    const ime =
      browserName === "chromium" && doc.name.startsWith("zh")
        ? await typeWithIme(page, 50)
        : [];
    const enter = await pressEnter(page, 20);
    const frames = await scrollThrough(page);
    const scrolled = await memory(page, browserName);
    const jump = await jumpToEnd(page);
    await caretToMiddle(page);
    const save = await saveAfterEdit(page, path);
    const tabs = await switchTabs(page, 5);

    // The costliest plugin hooks while typing: ms per call.
    const topPlugins = Object.fromEntries(
      Object.entries(typing.byPlugin)
        .sort(([, a], [, b]) => b.ms - a.ms)
        .slice(0, 8)
        .map(([name, s]) => [name, Math.round((s.ms / s.calls) * 100) / 100]),
    );
    const result = {
      doc: doc.name,
      chars: doc.markdown.length,
      blocks: doc.blocks,
      openVisibleMs: Math.round(open.visible),
      openReadyMs: Math.round(open.ready),
      heapMB: open.heapMB === null ? null : Math.round(open.heapMB),
      heapAfterGcMB: opened?.heapMB ?? null,
      domNodes: opened?.nodes ?? null,
      layoutObjects: opened?.layoutObjects ?? null,
      heapAfterScrollMB: scrolled?.heapMB ?? null,
      domNodesAfterScroll: scrolled?.nodes ?? null,
      keyLatencyP50: r1(pct(typing.latencies, 0.5)),
      keyLatencyP95: r1(pct(typing.latencies, 0.95)),
      dispatchP50: r1(pct(typing.dispatch, 0.5)),
      dispatchP95: r1(pct(typing.dispatch, 0.95)),
      pluginsP50: r1(pct(typing.plugins, 0.5)),
      pluginsP95: r1(pct(typing.plugins, 0.95)),
      longTasksTyping: typing.longTasks.length,
      longTasksOver100: typing.longTasks.filter((d) => d > 100).length,
      longestTaskTyping: Math.round(Math.max(0, ...typing.longTasks)),
      imeLatencyP50: ime.length ? r1(pct(ime, 0.5)) : null,
      imeLatencyP95: ime.length ? r1(pct(ime, 0.95)) : null,
      enterLatencyP50: r1(pct(enter, 0.5)),
      enterLatencyP95: r1(pct(enter, 0.95)),
      scrollFrames: frames.length,
      scrollFpsMedian: Math.round(1000 / Math.max(1, pct(frames, 0.5))),
      scrollFramesOver50: frames.filter((f) => f > 50).length,
      jumpMs: Math.round(jump.ms),
      saveP50: r1(pct(save, 0.5)),
      saveMax: r1(Math.max(...save)),
      tabSwitchP50: Math.round(pct(tabs, 0.5)),
      tabSwitchMax: Math.round(Math.max(...tabs)),
      topPlugins,
    };
    console.log(JSON.stringify(result, null, 1));
    const out = join(
      root,
      "test-results",
      "perf",
      process.env.PERF_LABEL ?? "",
    );
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, `${doc.name}.json`),
      JSON.stringify(result, null, 2),
    );
  });
}
