import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_DOC, mockInvoke, openApp, pasteMarkdown } from "../helpers";
import { STORY, STORY_CLASSICAL, streamRevise } from "../revise-mock";
import { FrameMeter, formatReports, type FrameReport } from "./frame-meter";

/**
 * The motion benchmark: every animated surface and scroll, timed frame by
 * frame. Not a test and not in CI; run `npm run bench:motion` (BENCH_CPU,
 * BENCH_OUT, BENCH_TRACE=1) to compare a change against main.
 */

const CPU = Number(process.env.BENCH_CPU ?? 4);
const OUT = process.env.BENCH_OUT ?? "test-results/motion-bench.json";
const TRACE = process.env.BENCH_TRACE === "1";
const ROUNDS = 3;

const reports: FrameReport[] = [];

const LONG_STORY = [STORY, STORY, STORY].join("\n\n");
const LONG_CLASSICAL = [STORY_CLASSICAL, STORY_CLASSICAL, STORY_CLASSICAL].join(
  "\n\n",
);
/** A document long enough that relaying it out is not free. */
const LONG_DOC = Array.from({ length: 8 }, () => SAMPLE_DOC).join("\n\n");

async function emit(page: Page, name: string) {
  await page.evaluate(
    (event) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(event),
    name,
  );
}

async function open(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await openApp(page, {
    animations: true,
    settings: { language: "en", revisionDisplay: "original" },
  });
}

async function send(page: Page, message: string) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

/** Measures `action` and keeps its report (and trace). A repeatable
 *  action runs once first, unmeasured: the first time also loads and
 *  compiles its code, which says nothing about its motion. */
async function bench(
  page: Page,
  name: string,
  action: () => Promise<void>,
  { settleMs, warmUp = true }: { settleMs?: number; warmUp?: boolean } = {},
) {
  if (warmUp) await action();
  const meter = await FrameMeter.attach(page, CPU);
  if (TRACE)
    await page
      .context()
      .browser()!
      .startTracing(page, {
        path: OUT.replace(
          /\.json$/,
          `-${name.replace(/\W+/g, "-")}.trace.json`,
        ),
      });
  const report = await meter.measure(name, action, settleMs);
  if (TRACE) await page.context().browser()!.stopTracing();
  reports.push(report);
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  const table = formatReports(reports);
  console.log(`\nMotion benchmark, CPU x${CPU}\n${table}\n`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ cpu: CPU, reports }, null, 2));
});

test("sidebar open and close", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await bench(page, "sidebar", async () => {
    for (let i = 0; i < ROUNDS * 2; i++) {
      await emit(page, "menu-toggle-sidebar");
      await page.waitForTimeout(450);
    }
  });
});

test("AI panel open and close", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await bench(page, "ai-panel", async () => {
    for (let i = 0; i < ROUNDS * 2; i++) {
      await emit(page, "menu-toggle-agent-panel");
      await page.waitForTimeout(450);
    }
  });
});

/** Drags a side panel's edge out and back, a pointer move a frame. */
async function dragEdge(page: Page, handle: string, by: number) {
  const box = (await page.locator(handle).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const [from, to] of [
    [0, by],
    [by, 0],
  ])
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(x + from + ((to - from) * i) / 30, y);
      await page.waitForTimeout(16);
    }
  await page.mouse.up();
}

test("side panels resized by their edge", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await emit(page, "menu-toggle-sidebar");
  await emit(page, "menu-toggle-agent-panel");
  await page.waitForTimeout(500);
  await bench(page, "sidebar-drag", () =>
    dragEdge(page, ".sidebar-resizer", 120),
  );
  await bench(page, "ai-panel-drag", () =>
    dragEdge(page, ".agent-panel-resizer", -120),
  );
});

test("Settings open and close", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await bench(page, "settings", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      await emit(page, "menu-open-settings");
      await page.waitForTimeout(450);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    }
  });
});

test("tab switching", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  for (let i = 0; i < 3; i++) {
    await emit(page, "menu-new-file");
    await page.waitForTimeout(200);
    await pasteMarkdown(page, LONG_DOC);
  }
  await bench(page, "tabs", async () => {
    for (let i = 0; i < ROUNDS * 4; i++) {
      await page.keyboard.press("Control+Tab");
      await page.waitForTimeout(250);
    }
  });
});

test("menus and popovers", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await bench(page, "menus", async () => {
    for (let i = 0; i < ROUNDS * 2; i++) {
      await page.locator(".window-menu-button").click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  });
});

test("InfoTip", async ({ page }) => {
  await open(page);
  await emit(page, "menu-open-settings");
  await page.getByRole("button", { name: "Editor & Appearance" }).click();
  const tip = page.locator(".info-tip-button").first();
  await tip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await bench(page, "infotip", async () => {
    for (let i = 0; i < ROUNDS * 2; i++) {
      await tip.hover();
      await page.waitForTimeout(350);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(250);
    }
  });
});

test("theme and appearance switching", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await bench(page, "appearance", async () => {
    for (let i = 0; i < ROUNDS * 2; i++) {
      await page.emulateMedia({ colorScheme: i % 2 ? "light" : "dark" });
      await page.waitForTimeout(350);
    }
  });
});

test("typewriter-mode scrolling", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, LONG_DOC);
  await emit(page, "menu-toggle-typewriter-mode");
  await page.locator('[data-active-tab="true"] .ProseMirror p').first().click();
  await bench(page, "typewriter", async () => {
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 20; i++) await page.keyboard.type("word ");
    await page.keyboard.press("Enter");
  });
});

async function proposeLongRevision(page: Page) {
  await pasteMarkdown(page, `${LONG_DOC}\n\n${LONG_STORY}\n\n${LONG_DOC}`);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: LONG_STORY,
          text: LONG_CLASSICAL,
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
}

test("revision stream: cards, fades, connectors, count", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, `${LONG_DOC}\n\n${LONG_STORY}`);
  await emit(page, "menu-toggle-agent-panel");
  await streamRevise(
    page,
    [
      {
        id: "s1",
        args: { action: "replace", anchor: LONG_STORY, text: LONG_CLASSICAL },
      },
    ],
    { chunk: 6, every: 16 },
  );
  await bench(
    page,
    "revision-stream",
    async () => {
      await send(page, "Classical Chinese, please");
      await expect(page.locator(".review-bar-accept")).toBeEnabled({
        timeout: 20_000,
      });
    },
    { warmUp: false },
  );
});

test("scrolling a long document with margin cards", async ({ page }) => {
  await open(page);
  await emit(page, "menu-toggle-agent-panel");
  await proposeLongRevision(page);
  await send(page, "go");
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await emit(page, "menu-toggle-agent-panel");
  await expect(page.locator(".revision-note")).toHaveCount(24);
  await page.waitForTimeout(600);
  const scroller = page.locator('[data-active-tab="true"] > .editor-scroll');
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await bench(page, "scroll-margin", async () => {
    for (const dir of [1, -1])
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, dir * 120);
        await page.waitForTimeout(16);
      }
  });
  // Pointing at cards one after another: each opens its line.
  const cards = page.locator(".revision-note");
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await page.locator(".revision-note").first().scrollIntoViewIfNeeded();
  await bench(page, "margin-hover", async () => {
    for (let i = 0; i < 8; i++) {
      await cards.nth(i).hover();
      await page.waitForTimeout(150);
    }
  });
});

test("diagram build-up", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, "The first paragraph.\n\nThe second paragraph.");
  await emit(page, "menu-toggle-agent-panel");
  const lines = [
    "```mermaid\n",
    "flowchart TD\n",
    ...Array.from(
      { length: 12 },
      (_, i) => `  N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]\n`,
    ),
    "```",
  ];
  await page.evaluate((lines) => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __nextLine?: () => void;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const text = lines.join("");
      const json = JSON.stringify({
        action: "insert_after",
        anchor: "The first paragraph.",
        text,
      });
      const cuts: number[] = [];
      let sent = 0;
      for (const line of lines) {
        sent += line.length;
        cuts.push(JSON.stringify(text.slice(0, sent)).length - 1);
      }
      const head = json.indexOf('"text":"') + '"text":"'.length;
      let from = 0;
      send({ type: "toolStart", callId: "s1", name: "propose_edit" });
      return new Promise((resolve) => {
        w.__nextLine = () => {
          const cut = cuts.shift();
          const to = cut === undefined ? json.length : head + cut - 1;
          send({
            type: "toolArgsDelta",
            callId: "s1",
            delta: json.slice(from, to),
          });
          from = to;
          if (cut !== undefined) return;
          const turns = [
            {
              kind: "ToolCall",
              call_id: "s1",
              name: "propose_edit",
              arguments: json,
            },
            { kind: "ToolResult", call_id: "s1", output: "Edit proposed" },
            { kind: "Assistant", text: "Drew it." },
          ];
          for (const turn of turns) send({ type: "turn", turn });
          resolve([{ kind: "User", text: message }, ...turns]);
        };
      });
    };
  }, lines);
  await send(page, "Draw the flow");
  await bench(
    page,
    "diagram-build",
    async () => {
      for (let i = 0; i <= lines.length; i++) {
        await page.evaluate(() =>
          (window as unknown as { __nextLine: () => void }).__nextLine(),
        );
        await page.waitForTimeout(150);
      }
    },
    { settleMs: 800, warmUp: false },
  );
});
