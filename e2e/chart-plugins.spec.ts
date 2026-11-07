import { expect, test, type Page } from "@playwright/test";
import { emit } from "./helpers";
import { hasPlugin, openWithPlugins, openPath } from "./plugin-helpers";

/**
 * Each chart plugin, from the checkout the dev server serves: a block is
 * drawn below its source, a mistake is reported under it, and an HTML export
 * carries the drawing as a picture.
 */

const CHARTS: [id: string, language: string, source: string][] = [
  ["catvinci.markmap", "markmap", "# Root\n## A\n- a1\n## B"],
  [
    "catvinci.echarts",
    "echarts",
    '{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] }',
  ],
  ["catvinci.plantuml", "plantuml", "@startuml\nAlice -> Bob : Hi\n@enduml"],
  [
    "catvinci.chartjs",
    "chartjs",
    '{ type: "bar", data: { labels: ["a", "b"], datasets: [{ label: "n", data: [1, 2] }] } }',
  ],
  ["catvinci.timeline", "timeline", "2024 | Start | the first\n2025 | End"],
  ["catvinci.abc", "abc", "X:1\nK:C\nC D E F |"],
  [
    "catvinci.wavedrom",
    "wavedrom",
    '{ signal: [{ name: "clk", wave: "p..." }] }',
  ],
  ["catvinci.function-plot", "function-plot", "sin(x)"],
];

async function exportHtml(page: Page): Promise<string> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __written?: string;
      __devEmitTauriEvent: (n: string) => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/c.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-export-html");
  });
  const written = () =>
    page.evaluate(
      () => (window as unknown as { __written?: string }).__written ?? "",
    );
  await expect.poll(written, { timeout: 30_000 }).toContain("</html>");
  return written();
}

test("every chart plugin's blocks are drawn, and exported as pictures", async ({
  page,
}) => {
  const charts = CHARTS.filter(([id]) => hasPlugin(id));
  test.skip(!charts.length, "no chart plugins in this checkout");
  test.setTimeout(90_000);
  const blocks = charts.map(
    ([, language, source]) => `\`\`\`${language}\n${source}\n\`\`\``,
  );
  await openWithPlugins(page, {
    plugins: Object.fromEntries(charts.map(([id]) => [id, []])),
    folder: { "/work/c.md": `# C\n\n${blocks.join("\n\n")}\n\nAfter.\n` },
  });
  await openPath(page, "/work/c.md");
  const frames = page.locator(
    '[data-active-tab="true"] .plugin-code-block iframe',
  );
  await expect(frames).toHaveCount(charts.length, { timeout: 30_000 });
  for (const [k, [, language]] of charts.entries()) {
    await test.step(language, async () => {
      await frames.nth(k).scrollIntoViewIfNeeded();
      const frame = frames.nth(k).contentFrame();
      await expect(
        frame.locator("#chart svg, #chart canvas").first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(frame.locator("#chart-problem")).toBeHidden();
    });
  }

  // Exported from the bottom: the blocks scrolled out of view, whose
  // frames have gone, still export their pictures.
  await frames.last().scrollIntoViewIfNeeded();
  const html = await exportHtml(page);
  const pictures = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return [
      ...doc.querySelectorAll<HTMLImageElement>("img.drawn-block-picture"),
    ].map((img) => img.src.slice(0, 20));
  }, html);
  expect(pictures).toHaveLength(charts.length);
  for (const picture of pictures)
    expect(picture).toMatch(/^data:image\/(svg\+xml|png)/);
});

test("a mistake in a chart's source is said under it", async ({ page }) => {
  test.skip(!hasPlugin("catvinci.echarts"), "no echarts plugin here");
  await openWithPlugins(page, {
    plugins: { "catvinci.echarts": [] },
    folder: { "/work/c.md": "# C\n\n```echarts\n{ not: valid: here }\n```\n" },
  });
  await openPath(page, "/work/c.md");
  const frame = page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
  await expect(frame.locator("#chart-problem")).toBeVisible({
    timeout: 20_000,
  });
});

test("split view's preview draws a plugin's block as the rendered view does", async ({
  page,
}) => {
  test.skip(
    !hasPlugin("catvinci.markmap"),
    "no markmap plugin in this checkout",
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.markmap": [] },
    folder: { "/work/m.md": "# M\n\n```markmap\n# Root\n## A\n```\n" },
  });
  await openPath(page, "/work/m.md");
  await emit(page, "menu-toggle-split-view");
  const frame = page
    .locator(
      '[data-active-tab="true"] .split-preview .plugin-code-block iframe',
    )
    .first();
  await expect(frame).toBeAttached({ timeout: 30_000 });
  await expect(frame.contentFrame().locator("#chart svg").first()).toBeVisible({
    timeout: 30_000,
  });
});
