import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin's own data (src-tauri plugins/store.rs, through the dev shim):
 * `textus.storage.global` for every document, `textus.storage.project` in
 * the open folder's `.textus/plugins/<id>/` - the project's only with
 * project.data, and one plugin never sees another's.
 */

const HOST = `
exports.activate = function () {
  textus.commands.registerCommand("test.keep.save", async function () {
    const g = textus.storage.global;
    const p = textus.storage.project;
    await g.set("count", ((await g.get("count")) || 0) + 1);
    await textus.storage.set("legacy", "same as global");
    let project = "refused";
    try {
      await p.set("board", { cards: 2 });
      await p.writeText("boards/one.md", "# One");
      project = (await p.keys()).join(",") + ";" + (await p.files()).join(",");
    } catch (err) {
      project = "refused: " + err.message;
    }
    await textus.window.showMessage(
      "global " + (await g.get("count")) + " " + (await g.keys()).join(",") +
        " | project " + project,
    );
  });
};
`;

function plugin(id: string, permissions: string[]) {
  return {
    id,
    dir: `/plugins/${id}`,
    manifest: JSON.stringify({
      id,
      name: id,
      version: "1.0.0",
      publisher: "test",
      description: "Keeps things.",
      engines: { textus: "^1.3.0" },
      main: "host.js",
      permissions,
      contributes: {
        commands: [{ command: "test.keep.save", title: "Save" }],
        menus: { "app/plugins": [{ command: "test.keep.save" }] },
      },
    }),
    dev: false,
    files: { "host.js": HOST },
  };
}

async function open(page: Page, granted: string[]) {
  await page.addInitScript(
    ({ entry, granted }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [entry];
      w.__devPluginState = {
        allOn: true,
        plugins: { [entry.id]: { enabled: true, granted } },
      };
      w.__devFs = { "/work/notes/a.md": "# A\n" };
    },
    { entry: plugin("test.keep", granted), granted },
  );
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-recent", "/work/notes/a.md"),
  );
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText("A");
}

async function save(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-plugin-command", "test.keep.save"),
  );
}

test("a plugin keeps its data globally and, granted, in the project", async ({
  page,
}) => {
  await open(page, ["project.data"]);
  await save(page);
  await expect(page.getByText(/^global 1 count,legacy/)).toBeVisible();
  await expect(page.getByText("project board;boards/one.md")).toBeVisible();
  const stores = await page.evaluate(
    () => (window as unknown as { __devPluginStore: object }).__devPluginStore,
  );
  expect(Object.keys(stores).sort()).toEqual([
    "test.keep|global|",
    "test.keep|project|/work/notes",
  ]);
  await page.getByRole("button", { name: "OK" }).click();
  await save(page);
  await expect(page.getByText(/^global 2 /)).toBeVisible();
});

test("without project.data a plugin keeps nothing in the folder", async ({
  page,
}) => {
  await open(page, []);
  await save(page);
  await expect(
    page.getByText("project refused: test.keep was not granted project.data."),
  ).toBeVisible();
});

test("its page says what a plugin keeps, and Clear empties it", async ({
  page,
}) => {
  await open(page, ["project.data"]);
  await save(page);
  await expect(page.getByText(/^global 1 /)).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-manage-plugins"),
  );
  await page
    .locator('.plugin-card[data-plugin="test.keep"] .plugin-card-open')
    .click();
  const own = page.locator('[data-plugin-page="test.keep"]');
  await expect(own).toContainText("for every document");
  await expect(own).toContainText("in this project");
  await own.getByRole("button", { name: "Clear", exact: true }).click();
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Clear" })
    .click();
  await expect(own).not.toContainText("for every document");
  expect(
    await page.evaluate(() =>
      Object.keys(
        (window as unknown as { __devPluginStore: object }).__devPluginStore,
      ),
    ),
  ).toEqual([]);
});
