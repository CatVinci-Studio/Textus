import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, pasteMarkdown } from "./helpers";
import {
  openPath,
  openSidebarTab,
  openWithPlugins,
  tabFrame,
} from "./plugin-helpers";

/**
 * The official plugins that work with notes and the folder: Quick Notes,
 * Calendar & Daily Notes, Tasks, Kanban and Version History.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test("a quick note is kept, and goes into the document as a proposal", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-notes": ["document.propose"] },
  });
  await pasteMarkdown(page, "The draft.");
  const panel = await openSidebarTab(page, "Quick Notes");
  await panel.getByRole("button", { name: "New" }).click();
  await panel.locator("textarea").fill("Call the printer");
  // Kept after the panel is closed and opened again.
  await page.waitForTimeout(500);
  await page.locator(".sidebar-tabs").getByRole("button").first().click();
  const again = await openSidebarTab(page, "Quick Notes");
  await expect(again.locator("textarea")).toHaveValue("Call the printer");
  await again.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator(`${editor} .pending-insert`)).toContainText(
    "Call the printer",
  );
});

test("a day in the calendar opens its note, made the first time", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.daily-notes": ["workspace.read", "workspace.write"] },
    folder: { "/notes/ideas.md": "# Ideas\n" },
  });
  await openPath(page, "/notes/ideas.md");
  await expect(page.locator(editor)).toContainText("Ideas");
  const calendar = await openSidebarTab(page, "Calendar");
  await calendar.locator(`.day[data-date="${today()}"]`).click();
  await expect(page.locator(editor)).toContainText(today());
  const written = await page.evaluate(
    (date) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        `/notes/Daily/${date}.md`
      ],
    today(),
  );
  expect(written).toBe(`# ${today()}\n\n`);
  await expect(calendar.locator(`.day[data-date="${today()}"]`)).toHaveClass(
    /has-note/,
  );
});

test("the folder's tasks are listed, and ticking one writes its line", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.tasks": ["workspace.read", "workspace.write"] },
    folder: {
      "/notes/plan.md":
        "# Plan\n\n## Week\n\n- [ ] Write the intro\n- [x] Pick a title\n",
      "/notes/other.md": "Nothing to do here.\n",
    },
  });
  await openPath(page, "/notes/other.md");
  const tasks = await openSidebarTab(page, "Tasks");
  await expect(tasks.locator("#summary")).toHaveText("1 open task");
  await expect(tasks.locator(".task")).toHaveCount(1);
  await expect(tasks.locator(".task .where")).toHaveText("Week");
  await tasks.getByRole("checkbox", { name: "Write the intro" }).check();
  await expect(tasks.locator("#summary")).toHaveText("0 open tasks");
  const file = await page.evaluate(
    () =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        "/notes/plan.md"
      ],
  );
  expect(file).toContain("- [x] Write the intro");
});

test("a board opens as lists of cards, and a card moved is written back", async ({
  page,
}) => {
  const board =
    "---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Outline\n- [ ] Research\n\n## Done\n";
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": ["workspace.read", "workspace.write"] },
    folder: { "/notes/Book.kanban.md": board },
  });
  await openPath(page, "/notes/Book.kanban.md");
  const frame = tabFrame(page);
  await expect(frame.locator(".list")).toHaveCount(2);
  await expect(frame.locator(".list").first().locator(".card")).toHaveCount(2);
  await frame
    .locator(".card", { hasText: "Outline" })
    .dragTo(frame.locator(".list").nth(1).locator(".cards"));
  await expect(frame.locator(".list").nth(1).locator(".card")).toHaveText([
    "Outline✕",
  ]);
  await expect(frame.locator("#state")).toHaveText("Saved");
  const file = await page.evaluate(
    () =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        "/notes/Book.kanban.md"
      ],
  );
  expect(file).toContain("## Done\n\n- [ ] Outline");
  expect(file).toContain("kanban-plugin: basic");
});

test("each save is a version, shown against the text now and restorable", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.version-history": [
        "workspace.read",
        "document.read",
        "document.propose",
      ],
    },
    folder: { "/notes/essay.md": "First line\n" },
  });
  await openPath(page, "/notes/essay.md");
  const save = () =>
    page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-save-file"),
    );
  await page.locator(editor).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await save();
  const history = await openSidebarTab(page, "History");
  await expect(history.locator("#versions > li")).toHaveCount(1);
  await page.locator(editor).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" again");
  await save();
  await expect(history.locator("#versions > li")).toHaveCount(2);
  await history.locator("#versions > li").nth(1).click();
  await expect(history.locator(".diff .added")).toContainText("again");
  await history.getByRole("button", { name: "Restore This Version" }).click();
  // The version now as a proposal over the text: the old line offered,
  // the current one struck.
  await expect(page.locator(`${editor} .pending-insert`)).toHaveText(
    "First line and more",
  );
  await expect(page.locator(`${editor} .pending-delete`)).toHaveText(
    "First line and more again",
  );
});

const runCommand = (page: Page, command: string) =>
  page.evaluate(
    (c) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-plugin-command", c),
    command,
  );

test("a citation searched in Zotero goes in where the caret is", async ({
  page,
}) => {
  const items = [
    {
      key: "ABCD1234",
      data: {
        title: "On the Origin of Species",
        creators: [{ creatorType: "author", lastName: "Darwin" }],
        date: "1859",
        citationKey: "darwin1859",
      },
    },
  ];
  await openWithPlugins(page, {
    plugins: {
      "catvinci.zotero": ["network:localhost:23119", "document.propose"],
    },
  });
  await pasteMarkdown(page, "As shown ");
  await mockInvoke(page, {
    plugin_http: {
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(items)).toString("base64"),
    },
  });
  await page.locator(editor).click();
  await page.keyboard.press("End");
  await runCommand(page, "catvinci.zotero.cite");
  await page.locator(".app-dialog-input").fill("darwin");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quick-pick-item")).toContainText(
    "On the Origin of Species",
  );
  await expect(page.locator(".quick-pick-item")).toContainText("Darwin · 1859");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} .pending-insert`)).toHaveText(
    "[@darwin1859]",
  );
  const asked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __devInvokeCalls: { cmd: string; request?: { url: string } }[];
        }
      ).__devInvokeCalls,
  );
  expect(asked.find((c) => c.cmd === "plugin_http")?.request?.url).toContain(
    "localhost:23119/api/users/0/items/top?q=darwin",
  );
});

test("the graph draws the folder's notes and links, and the sidebar the ones around", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.graph": ["workspace.read", "document.read"] },
    folder: {
      "/notes/a.md": "Links to [[b]] and [c](c.md).",
      "/notes/b.md": "An [[unwritten idea]].",
      "/notes/c.md": "Plain.",
      "/notes/d.md": "Alone.",
    },
  });
  await openPath(page, "/notes/a.md");
  await expect(page.locator(editor)).toContainText("Links to");
  const local = await openSidebarTab(page, "Graph");
  await expect(local.locator("#stats")).toHaveText("3 notes · 2 links");
  await runCommand(page, "catvinci.graph.open");
  const full = tabFrame(page);
  await expect(full.locator("#stats")).toHaveText("5 notes · 3 links");
  await expect(full.locator("canvas")).toBeVisible();
});
