import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin's tools for Textus AI (contributes.aiTools, with ai.tools;
 * src-tauri plugins/ai_tools.rs through the dev shim): the window offers
 * them from the manifest before the plugin has started, a call starts it
 * and its answer goes back, and without ai.tools nothing is offered.
 */

const HOST = `
exports.activate = function () {
  textus.ai.registerTool("count_words", function (args) {
    return String(String(args.text || "").split(/\\s+/).filter(Boolean).length) + " words";
  });
};
`;

function plugin(granted: string[]) {
  return {
    entry: {
      id: "test.tools",
      dir: "/plugins/test.tools",
      manifest: JSON.stringify({
        id: "test.tools",
        name: "Tools",
        version: "1.0.0",
        publisher: "test",
        description: "Counts words for Textus AI.",
        engines: { textus: "^1.3.0" },
        main: "host.js",
        permissions: ["ai.tools"],
        contributes: {
          aiTools: [
            {
              name: "count_words",
              description: "Counts the words of a text.",
              parameters: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        },
      }),
      dev: false,
      files: { "host.js": HOST },
    },
    granted,
  };
}

async function open(page: Page, granted: string[]) {
  await page.addInitScript(({ entry, granted }) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted } },
    };
  }, plugin(granted));
  await openApp(page, { settings: { language: "en" } });
}

const offered = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devAiTools?: unknown[] }).__devAiTools,
  );

test("a plugin's tool is offered to Textus AI and runs when called", async ({
  page,
}) => {
  await open(page, ["ai.tools"]);
  await expect
    .poll(() => offered(page))
    .toEqual([
      {
        plugin: "test.tools",
        name: "count_words",
        description: "Counts the words of a text.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ]);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("plugin-ai-tool-call", {
      callId: "call-1",
      plugin: "test.tools",
      name: "count_words",
      arguments: { text: "one two three" },
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __devAiToolResults?: Record<string, unknown>;
            }
          ).__devAiToolResults?.["call-1"],
      ),
    )
    .toEqual({ text: "3 words" });
});

test("without ai.tools a plugin offers Textus AI nothing", async ({ page }) => {
  await open(page, []);
  await expect.poll(() => offered(page)).toEqual([]);
});
