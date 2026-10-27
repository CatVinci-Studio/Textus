import { expect, test, type Page } from "@playwright/test";
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

for (const [id, language, source] of CHARTS)
  test(`${language} blocks are drawn, and exported as a picture`, async ({
    page,
  }) => {
    test.skip(!hasPlugin(id), `${id} is not in this checkout`);
    test.setTimeout(60_000);
    await openWithPlugins(page, {
      plugins: { [id]: [] },
      folder: {
        "/work/c.md": `# C\n\n\`\`\`${language}\n${source}\n\`\`\`\n\nAfter.\n`,
      },
    });
    await openPath(page, "/work/c.md");
    const frame = page
      .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
      .first();
    await expect(
      frame.locator("#chart svg, #chart canvas").first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator("#chart-problem")).toBeHidden();

    const html = await exportHtml(page);
    const picture = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, "text/html");
      return (
        doc.querySelector<HTMLImageElement>("img.drawn-block-picture")?.src ??
        ""
      );
    }, html);
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
