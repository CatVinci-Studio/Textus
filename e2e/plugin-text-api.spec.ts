import { expect, test } from "@playwright/test";
import { emit, openApp } from "./helpers";

/** textus.dates and textus.templates: computed in the plugin's own frame,
 *  with no permission, the folder's Obsidian formats used when it may read. */

const HOST = `
exports.activate = function () {
  textus.ai.registerTool("fill", async function () {
    var day = new Date(2026, 10, 7, 9, 5);
    var filled = await textus.templates.fill(
      "# {{title}}\\n{{date}} {{time}} {{date:dddd}} {{project}} <% tp.date.now('YYYY') %>",
      { title: "Plan", now: day, values: { project: "Textus" } },
    );
    return JSON.stringify({
      format: textus.dates.format(day, "gggg-[W]ww"),
      parse: textus.dates.parse("07.11.2026", "DD.MM.YYYY"),
      filled: filled.text,
    });
  });
};
`;

test("a plugin formats and reads dates and fills a template in the folder's formats", async ({
  page,
}) => {
  await page.addInitScript((host) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/vault/.obsidian/app.json": "{}",
      "/vault/.obsidian/templates.json": '{"dateFormat":"DD.MM.YYYY"}',
      "/vault/a.md": "# A",
    };
    w.__devPlugins = [
      {
        id: "test.text",
        dir: "/plugins/test.text",
        manifest: JSON.stringify({
          id: "test.text",
          name: "Text",
          version: "1.0.0",
          publisher: "test",
          description: "Dates and templates.",
          engines: { textus: "^1.3.0" },
          main: "host.js",
          permissions: ["ai.tools", "files.read"],
          contributes: {
            aiTools: [
              {
                name: "fill",
                description: "Fills a template.",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        }),
        dev: false,
        files: { "host.js": host },
      },
    ];
    w.__devPluginState = {
      allOn: true,
      plugins: {
        "test.text": { enabled: true, granted: ["ai.tools", "files.read"] },
      },
    };
  }, HOST);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-recent", "/vault/a.md");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __devAiTools?: unknown }).__devAiTools,
      ),
    )
    .toBeTruthy();
  await emit(page, "plugin-ai-tool-call", {
    callId: "call-1",
    plugin: "test.text",
    name: "fill",
    arguments: {},
  });
  const result = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __devAiToolResults?: Record<string, { text?: string }>;
          }
        ).__devAiToolResults?.["call-1"]?.text,
    );
  await expect.poll(result).toBeTruthy();
  expect(JSON.parse((await result())!)).toEqual({
    format: "2026-W45",
    parse: "2026-11-07",
    filled: "# Plan\n07.11.2026 09:05 Saturday Textus 2026",
  });
});
