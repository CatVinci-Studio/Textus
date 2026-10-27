import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * textus.files.onWillSave: a plugin's change before saving goes into the
 * editor too, so what is saved is what shows.
 */

const HOST = `
exports.activate = function () {
  textus.files.onWillSave(function (e) {
    return e.text.trimEnd() + "\\n\\nStamped.\\n";
  });
};
`;

const ENTRY = {
  id: "test.stamp",
  dir: "/plugins/test.stamp",
  manifest: JSON.stringify({
    id: "test.stamp",
    name: "Stamp",
    version: "1.0.0",
    publisher: "test",
    description: "Stamps a document as it is saved.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["files.write"],
    activationEvents: ["onStartupFinished"],
  }),
  dev: false,
  files: { "host.js": HOST },
};

async function emit(page: Page, name: string, payload?: unknown) {
  await page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, p: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

test("a plugin's onWillSave changes what is saved, and the editor shows it", async ({
  page,
}) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: ["files.write"] } },
    };
    w.__devFs = { "/work/a.md": "# A\n\nFirst.\n" };
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-recent", "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h1")).toContainText("A");

  await editor.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  // Saved once the plugin has started and listens.
  await expect(async () => {
    await emit(page, "menu-save-file");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __devFs: Record<string, string> })
                .__devFs["/work/a.md"],
          ),
        { timeout: 1000 },
      )
      .toContain("Stamped.");
  }).toPass();
  const saved = await page.evaluate(
    () =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        "/work/a.md"
      ],
  );
  expect(saved).toContain("First. More.");
  await expect(editor).toContainText("Stamped.");
  // What shows is what was saved: nothing left unsaved.
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
});
