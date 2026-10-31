import type { Page } from "@playwright/test";
import type { LargeDoc } from "./large-docs";

// What the benchmarks measure with, in the page and from the test: long
// tasks, input-to-frame latency, per-plugin time in each dispatch, and
// opening a document by a drop.

/** What the page keeps while it is measured (installed before load). */
export function installProbes() {
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

export interface Bench {
  longTasks: { start: number; duration: number }[];
  latencies: number[];
  plugins: Record<string, { ms: number; calls: number }>;
  perDispatch: { total: number; plugins: number }[];
  settled: () => Promise<void>;
  instrument: () => void;
}
export type BenchWindow = Window & { __bench: Bench };

export function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
export const r1 = (n: number) => Math.round(n * 10) / 10;

export async function openDoc(page: Page, doc: LargeDoc, path: string) {
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

export function firstLine(doc: LargeDoc): string {
  return doc.markdown.split("\n")[0].replace(/^#+ /, "");
}

/** The caret at the end of a paragraph in the middle of the document. */
export async function caretToMiddle(page: Page) {
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
