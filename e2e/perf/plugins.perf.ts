import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import { openApp } from "../helpers";
import { pluginsAtStart } from "../plugin-helpers";
import { pluginsCheckout } from "../../vite.dev-plugins";
import { largeFolder, largeLinkedDoc, noteTitle } from "./large-folder";
import {
  caretToMiddle,
  installProbes,
  openDoc,
  pct,
  r1,
  type BenchWindow,
} from "./probes";

// Each official plugin alone, none, and all of them, with a folder of
// thousands of notes open and its 1.2-million-character document in front:
// opening, what runs while nothing is typed, typing in the middle and
// switching to a small note. Asserts nothing about the numbers.
// Env: PERF_PLUGINS (ids, or none / all), PERF_NOTES (default 5000),
// PERF_CHARS (default 60), PERF_LABEL.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const NOTES = Number(process.env.PERF_NOTES) || 5000;
const CHARS = Number(process.env.PERF_CHARS) || 60;
const FOLDER = "/vault";

// Plugins' frames run in the page's process in WebKit; Chromium would move
// sandboxed frames out of it and hide their cost from the page.
test.use({
  launchOptions: {
    args: ["--disable-features=IsolateSandboxedIframes,SitePerProcess"],
  },
});

const checkout = pluginsCheckout();
const manifests = checkout
  ? readdirSync(join(checkout, "plugins"))
      .filter((id) => id.startsWith("catvinci."))
      .sort()
      .map((id) => {
        const m = JSON.parse(
          readFileSync(
            join(checkout, "plugins", id, "textus-plugin.json"),
            "utf8",
          ),
        ) as { permissions?: string[] };
        return { id, permissions: m.permissions ?? [] };
      })
  : [];
const grants = (ids: string[]) =>
  Object.fromEntries(
    manifests
      .filter((m) => ids.includes(m.id))
      .map((m) => [m.id, m.permissions]),
  );

const SETS: { name: string; ids: string[] }[] = [
  { name: "none", ids: [] },
  ...manifests.map((m) => ({
    name: m.id.replace("catvinci.", ""),
    ids: [m.id],
  })),
  { name: "all", ids: manifests.map((m) => m.id) },
];
const only = process.env.PERF_PLUGINS?.split(",").map((s) => s.trim());

const folder = largeFolder(FOLDER, NOTES);
const doc = largeLinkedDoc(NOTES);
const docPath = `${FOLDER}/大文档.md`;
folder[docPath] = doc.markdown;
const small = Object.keys(folder).find((p) =>
  p.endsWith(`/${noteTitle(1)}.md`),
)!;

const results: Record<string, unknown>[] = [];

async function idle(page: Page, ms: number) {
  const start = await page.evaluate(() => performance.now());
  await page.waitForTimeout(ms);
  return page.evaluate((start) => {
    const tasks = (window as unknown as BenchWindow).__bench.longTasks.filter(
      (t) => t.start >= start,
    );
    return tasks.reduce((sum, t) => sum + t.duration, 0);
  }, start);
}

/** Every sidebar tab a plugin added (after the three built-in ones), one
 *  after another, the last left open: their panels index the folder. */
async function openPluginPanels(page: Page) {
  if (await page.locator(".sidebar.sidebar-collapsed").count())
    await page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-toggle-sidebar"),
    );
  const tabs = page.locator(".sidebar .sidebar-tab");
  const count = await tabs.count();
  for (let i = 3; i < count; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(1500);
  }
  return Math.max(0, count - 3);
}

async function typeMiddle(page: Page) {
  await caretToMiddle(page);
  await page.evaluate(() => {
    const b = (window as unknown as BenchWindow).__bench;
    b.latencies.length = 0;
  });
  const start = await page.evaluate(() => performance.now());
  const text = "大文档里打字应该和小文档一样流畅";
  for (let i = 0; i < CHARS; i++) {
    await page.keyboard.type(text[i % text.length]);
    await page.evaluate(() =>
      (window as unknown as BenchWindow).__bench.settled(),
    );
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);
  return page.evaluate((start) => {
    const b = (window as unknown as BenchWindow).__bench;
    const tasks = b.longTasks.filter((t) => t.start >= start);
    return {
      latencies: [...b.latencies],
      longMs: tasks.reduce((sum, t) => sum + t.duration, 0),
    };
  }, start);
}

async function openSmall(page: Page) {
  return page.evaluate(async (path) => {
    const w = window as unknown as {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    const start = performance.now();
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: [path],
      position: { x: 0, y: 0 },
    });
    const title = path.split("/").pop()!.replace(/\.md$/, "");
    await new Promise<void>((resolve) => {
      const look = () => {
        const el = document.querySelector(
          '[data-active-tab="true"] .ProseMirror h1',
        );
        if (el?.textContent?.includes(title)) resolve();
        else requestAnimationFrame(look);
      };
      look();
    });
    return performance.now() - start;
  }, small);
}

for (const set of SETS) {
  if (only && !only.includes(set.name)) continue;
  test(`plugins: ${set.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.addInitScript(installProbes);
    // The folder comes after the start, by one evaluate: an init script's
    // arguments go into every frame, plugins' own included.
    await pluginsAtStart(page, { plugins: grants(set.ids) });
    await page.addInitScript((path) => {
      (window as unknown as { __devPickFolder: string }).__devPickFolder = path;
    }, FOLDER);
    await openApp(page, { settings: { language: "zh" } });
    await page.evaluate((files) => {
      (window as unknown as { __devFs: Record<string, string> }).__devFs =
        files;
    }, folder);
    await page.evaluate(() =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string) => void;
        }
      ).__devEmitTauriEvent("menu-open-folder"),
    );
    await page.waitForTimeout(1000);
    const opened = await openDoc(page, doc, docPath);
    const panels = await openPluginPanels(page);
    const idleMs = await idle(page, 8000);
    const typed = await typeMiddle(page);
    const switchMs = await openSmall(page);
    const row = {
      set: set.name,
      plugins: set.ids.length,
      panels,
      visibleMs: r1(opened.visible),
      readyMs: r1(opened.ready),
      heapMB: opened.heapMB && r1(opened.heapMB),
      idleLongMs: r1(idleMs),
      keyP50: r1(pct(typed.latencies, 0.5)),
      keyP95: r1(pct(typed.latencies, 0.95)),
      typingLongMs: r1(typed.longMs),
      switchMs: r1(switchMs),
      errors: errors.length,
      firstError: errors[0]?.slice(0, 160) ?? "",
    };
    results.push(row);
    console.log(JSON.stringify(row));
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  const dir = join(root, "test-results", "perf");
  mkdirSync(dir, { recursive: true });
  const label = process.env.PERF_LABEL ?? "plugins";
  writeFileSync(
    join(dir, `${label}-${Date.now()}.json`),
    JSON.stringify({ notes: NOTES, chars: CHARS, results }, null, 2),
  );
});
