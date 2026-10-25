import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp, pasteMarkdown } from "./helpers";

// Settings › Editor & Appearance › Diagram engine: Mermaid by default, Pele
// (pele.run) when chosen, with Mermaid drawing whatever Pele can't. Each
// engine is fetched only when a diagram needs it; a Pele diagram's colours
// are CSS variables, so it follows the appearance and an imported theme
// without being drawn again; exports carry the SVG either way.

const FLOW = "```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```\n\nEnd.";
const preview = '[data-active-tab="true"] .ProseMirror .mermaid-preview';
const peleSvg = `${preview} > svg.pele`;
const mermaidSvg = `${preview} > svg:not(.pele)`;

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([name, payload]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, payload),
    [name, payload] as const,
  );
}

/** The engines' own modules the page fetched (the dev server serves each
 *  pre-bundled under node_modules/.vite/deps). */
function engineRequests(page: Page) {
  const seen = { mermaid: false, pele: false };
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/node_modules/")) return;
    if (/\/mermaid[._]/.test(url)) seen.mermaid = true;
    if (/\/pele[._]/.test(url)) seen.pele = true;
  });
  return seen;
}

async function chooseEngine(page: Page, name: string) {
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await panel.getByRole("combobox", { name: "Diagram engine" }).click();
  await page.getByRole("option", { name }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

/** The computed fill of the first node's shape and label. */
function nodeColours(page: Page) {
  return page.locator(peleSvg).evaluate((svg) => {
    const shape = svg.querySelector(".pele-node rect, .pele-node polygon")!;
    const label = svg.querySelector(".pele-node text")!;
    return {
      shape: getComputedStyle(shape).fill,
      label: getComputedStyle(label).fill,
      box: getComputedStyle(svg.parentElement!).color,
    };
  });
}

/** Relative luminance of an rgb()/color(srgb) value, 0 (black) to 1. */
function luminance(colour: string): number {
  const parts = colour.match(/[\d.]+/g)!.map(Number);
  const [r, g, b] = colour.startsWith("color(")
    ? parts.slice(0, 3)
    : parts.slice(0, 3).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("Mermaid draws diagrams unless Pele is chosen, and Pele is never fetched", async ({
  page,
}) => {
  const seen = engineRequests(page);
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(mermaidSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(peleSvg)).toHaveCount(0);
  expect(seen).toEqual({ mermaid: true, pele: false });
});

test("neither engine is fetched for a document without diagrams", async ({
  page,
}) => {
  const seen = engineRequests(page);
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, "# Notes\n\n```js\nconst a = 1;\n```\n");
  await page.waitForTimeout(800);
  expect(seen).toEqual({ mermaid: false, pele: false });
});

test("with Pele chosen a diagram is drawn by Pele and Mermaid is never fetched", async ({
  page,
}) => {
  const seen = engineRequests(page);
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(`${peleSvg} .pele-node`)).toHaveCount(2);
  expect(seen).toEqual({ mermaid: false, pele: true });
});

test("switching the diagram engine in Settings redraws an open diagram", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(mermaidSvg)).toHaveCount(1, { timeout: 10_000 });

  await chooseEngine(page, "Pele (faster)");
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(mermaidSvg)).toHaveCount(0);

  await chooseEngine(page, "Mermaid (most compatible)");
  await expect(page.locator(mermaidSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(peleSvg)).toHaveCount(0);
});

test("a diagram Pele throws on is drawn by Mermaid instead", async ({
  page,
}) => {
  // Pele's module, answering every diagram with an error.
  await page.route(/\/node_modules\/\.vite\/deps\/pele_lazy\.js/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export async function renderAsync() { throw new Error("boom"); }',
    }),
  );
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(mermaidSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(peleSvg)).toHaveCount(0);
});

test("a diagram with HTML in a label is left to Mermaid, the others drawn by Pele", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(
    page,
    FLOW.replace("\n\nEnd.", "") +
      '\n\n```mermaid\nflowchart LR\n  A["<span>html</span>"] --> B\n```\n\nEnd.',
  );
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(mermaidSvg)).toHaveCount(1, { timeout: 10_000 });
});

test("a Pele diagram changes colour with the appearance without being redrawn", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await page.locator(peleSvg).evaluate((svg) => {
    (svg as unknown as { __first: boolean }).__first = true;
  });
  const light = await nodeColours(page);
  expect(light.label).toBe(light.box);
  expect(luminance(light.label)).toBeLessThan(0.3);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(async () => luminance((await nodeColours(page)).label))
    .toBeGreaterThan(0.6);
  const dark = await nodeColours(page);
  expect(dark.label).toBe(dark.box);
  expect(dark.shape).not.toBe(light.shape);
  expect(luminance(dark.shape)).toBeLessThan(0.3);
  // The same element: recoloured through the CSS variables, not drawn again.
  await page.waitForTimeout(700);
  expect(
    await page
      .locator(peleSvg)
      .evaluate((svg) => (svg as unknown as { __first?: boolean }).__first),
  ).toBe(true);
});

test("a Pele diagram takes its text colour from an imported Typora theme", async ({
  page,
}) => {
  const css = readFileSync(
    new URL("./fixtures/themes/newsprint-like.css", import.meta.url),
    "utf8",
  );
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await importTheme(page, css);
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  const colours = await nodeColours(page);
  // newsprint-like.css sets the page's text to #333.
  expect(colours.box).toBe("rgb(51, 51, 51)");
  expect(colours.label).toBe(colours.box);
});

test("split view draws a diagram with the chosen engine", async ({ page }) => {
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, FLOW);
  await emit(page, "menu-toggle-split-view");
  await expect(
    page.locator(
      '[data-active-tab="true"] .split-preview .mermaid-preview > svg.pele',
    ),
  ).toHaveCount(1, { timeout: 10_000 });
});

test("an HTML export of a Pele diagram embeds it as SVG", async ({
  page,
  context,
}) => {
  await openApp(page, { settings: { language: "en", diagramEngine: "pele" } });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __written?: string;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
  });
  await emit(page, "menu-export-html");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __written?: string }).__written ?? "",
      ),
    )
    .toContain('class="pele pele-flowchart"');
  const html = await page.evaluate(
    () => (window as unknown as { __written: string }).__written,
  );
  // The file on its own, as a browser opens it: the diagram is there and
  // its colours resolve from the stylesheet the export carries.
  const exported = await context.newPage();
  await exported.setContent(html);
  const svg = exported.locator(".mermaid-preview > svg.pele");
  await expect(svg).toHaveCount(1);
  await expect(svg.locator(".pele-node")).toHaveCount(2);
  const label = await svg
    .locator(".pele-node text")
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  expect(luminance(label)).toBeLessThan(0.3);
});

test("a PDF export printed on white keeps a Pele diagram drawn in a dark appearance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  });
  await openApp(page, {
    settings: { language: "en", diagramEngine: "pele" },
    colorScheme: "dark",
  });
  await pasteMarkdown(page, FLOW);
  await expect(page.locator(peleSvg)).toHaveCount(1, { timeout: 10_000 });
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __pdfHtml?: string;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.pdf");
      if (cmd === "export_pdf_native") {
        w.__pdfHtml = String(args?.html);
        return Promise.resolve();
      }
      if (cmd === "reveal_in_dir") return Promise.resolve();
      return invoke(cmd, args);
    };
  });
  await emit(page, "menu-export-pdf");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __pdfHtml?: string }).__pdfHtml ?? "",
      ),
    )
    .toContain('class="pele pele-flowchart"');
});

/** Imports `css` as a theme through Settings › Extensions › Themes › Import CSS…, answering the
 *  file picker and the theme store from memory (as user-css.spec.ts). */
async function importTheme(page: Page, css: string) {
  await page.evaluate((css) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
    };
    const saved: Record<string, string> = {};
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
      switch (cmd) {
        case "open_css_file_dialog":
          return "/themes/newsprint-like.css";
        case "read_text_file":
          if (args.path === "/themes/newsprint-like.css") return css;
          break;
        case "save_theme_css":
          saved[`${args.id}:${args.variant}`] = String(args.css);
          return null;
        case "load_theme_css":
          return saved[`${args.id}:${args.variant}`] ?? null;
      }
      return original(cmd, args);
    };
  }, css);
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await panel.getByRole("button", { name: "Get more themes" }).click();
  await panel.getByRole("button", { name: "More", exact: true }).click();
  await panel.getByRole("menuitem", { name: "Import CSS…" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}
