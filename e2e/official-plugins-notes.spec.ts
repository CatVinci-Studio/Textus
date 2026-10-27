import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, pasteMarkdown } from "./helpers";
import {
  openPath,
  openSidebarList,
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

test("a quick note is kept, and Insert writes it into the document", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-notes": ["editor.write"] },
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
  // Written at once, one undo away - asked for by the click.
  await expect(page.locator(editor)).toContainText("Call the printer");
  await expect(page.locator(`${editor} .pending-insert`)).toHaveCount(0);
});

test("a deleted quick note comes back with Undo, and an empty one goes by itself", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-notes": ["editor.write"] },
  });
  const panel = await openSidebarTab(page, "Quick Notes");
  await panel.getByRole("button", { name: "New" }).click();
  await panel.locator("textarea").fill("Keep me");
  await page.waitForTimeout(400);
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(panel.locator("textarea")).toHaveCount(0);
  await panel.getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator("textarea")).toHaveValue("Keep me");
  // A new note left empty doesn't stay.
  await panel.getByRole("button", { name: "New" }).click();
  await expect(panel.locator("textarea")).toHaveCount(2);
  await panel.locator("textarea").first().blur();
  await expect(panel.locator("textarea")).toHaveCount(1);
});

test("a day in the calendar opens its note, made the first time", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.daily-notes": ["files.read", "files.write", "editor.read"],
    },
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
    plugins: { "catvinci.tasks": ["files.read", "files.write"] },
    folder: {
      "/notes/plan.md":
        "# Plan\n\n## Week\n\n- [ ] Write the intro\n- [x] Pick a title\n",
      "/notes/other.md": "Nothing to do here.\n",
    },
  });
  await openPath(page, "/notes/other.md");
  // A list Textus draws (views.registerList), in the page itself.
  const tasks = await openSidebarList(page, "Tasks");
  await expect(tasks.locator(".plugin-list-message")).toHaveText("1 open task");
  await expect(tasks.locator(".plugin-list-row")).toHaveCount(1);
  await expect(tasks.locator(".plugin-list-group")).toHaveText("plan.md");
  await expect(tasks.locator(".plugin-list-description")).toHaveText("Week");
  // click, not check: a ticked task leaves the list (Done is off), and
  // check() would wait for a box that is gone to read as checked.
  await tasks.getByRole("checkbox", { name: "Write the intro" }).click();
  await expect(tasks.locator(".plugin-list-message")).toHaveText(
    "0 open tasks",
  );
  const file = await page.evaluate(
    () =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        "/notes/plan.md"
      ],
  );
  expect(file).toContain("- [x] Write the intro");
});

test("tasks due soon come first, with their dates, and the filter narrows the list", async ({
  page,
}) => {
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  await openWithPlugins(page, {
    plugins: { "catvinci.tasks": ["files.read", "files.write"] },
    folder: {
      "/notes/plan.md": `# Plan\n\n- [ ] Send the draft 📅 ${day(-1)}\n- [ ] Book the hall due:${day(3)}\n- [ ] Someday maybe 📅 ${day(40)}\n- [ ] Read more\n`,
    },
  });
  await openPath(page, "/notes/plan.md");
  const tasks = await openSidebarList(page, "Tasks");
  // One line high, not stretched down the sidebar.
  const filter = await tasks.locator(".plugin-list-filter").boundingBox();
  expect(filter?.height).toBeLessThan(48);
  const groups = tasks.locator(".plugin-list-group");
  await expect(groups.first()).toHaveText("Due soon");
  // Past due and within a week, soonest first, above the document's own
  // list of all four; the far one isn't due soon.
  const rows = tasks.locator(".plugin-list-row");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("Send the draft");
  await expect(rows.nth(1)).toContainText("Book the hall");
  await expect(rows.first().locator(".plugin-list-badge")).toHaveAttribute(
    "data-tone",
    "danger",
  );
  // The date marker is read, not shown as typed.
  await expect(rows.first()).not.toContainText("📅");
  await tasks.getByRole("textbox", { name: "Filter tasks" }).fill("hall");
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).toContainText("Book the hall");
});

test("tasks in a file with Windows line endings are listed and ticked", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.tasks": ["files.read", "files.write"] },
    folder: {
      "/notes/win.md": "# Win\r\n\r\n- [ ] Ship it\r\n- [ ] Tell them\r\n",
    },
  });
  await openPath(page, "/notes/win.md");
  const tasks = await openSidebarList(page, "Tasks");
  await expect(tasks.locator(".plugin-list-message")).toHaveText(
    "2 open tasks",
  );
  await expect(tasks.locator(".plugin-list-description").first()).toHaveText(
    "Win",
  );
  await tasks.getByRole("checkbox", { name: "Ship it" }).click();
  await expect(tasks.locator(".plugin-list-message")).toHaveText("1 open task");
  const file = await page.evaluate(
    () =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[
        "/notes/win.md"
      ],
  );
  expect(file).toBe("# Win\r\n\r\n- [x] Ship it\r\n- [ ] Tell them\r\n");
});

test("a card's [[link]] opens its note, and a list dragged by its head moves", async ({
  page,
}) => {
  const board =
    "---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Read [[Plan]] first\n\n## Doing\n\n## Done\n";
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": ["files.read", "files.write"] },
    folder: {
      "/notes/Book.kanban.md": board,
      "/notes/Plan.md": "# The plan\n",
    },
  });
  await openPath(page, "/notes/Book.kanban.md");
  const frame = tabFrame(page);
  await expect(frame.locator(".list-title")).toHaveText([
    "To do",
    "Doing",
    "Done",
  ]);
  // Done to the front.
  await frame
    .locator(".list-head")
    .nth(2)
    .dragTo(frame.locator(".list").first());
  await expect(frame.locator(".list-title")).toHaveText([
    "Done",
    "To do",
    "Doing",
  ]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFs: Record<string, string> }).__devFs[
            "/notes/Book.kanban.md"
          ],
      ),
    )
    .toMatch(/## Done[\s\S]*## To do[\s\S]*## Doing/);
  await frame.getByRole("link", { name: "Plan" }).click();
  await expect(page.locator(editor)).toContainText("The plan");
});

test("a board opens as lists of cards, and a card moved is written back", async ({
  page,
}) => {
  const board =
    "---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Outline\n- [ ] Research\n\n## Done\n";
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": ["files.read", "files.write"] },
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

test("saves close together are one version, listed under Today", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.version-history": [
        "files.read",
        "editor.read",
        "editor.propose",
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
  const history = await openSidebarTab(page, "History");
  for (const words of [" one", " two", " three"]) {
    await page.locator(editor).click();
    await page.keyboard.press("End");
    await page.keyboard.type(words);
    await save();
    await page.waitForTimeout(300);
  }
  await expect(history.locator(".day-head")).toHaveText("Today");
  // Within 15 minutes (the default): one version, the latest text.
  await expect(history.locator("#versions > li:not(.day-head)")).toHaveCount(1);
  await history.locator("#versions > li:not(.day-head)").click();
  await expect(history.locator(".diff")).toContainText("three");
});

test("each save is a version, shown against the text now and restorable", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.version-history": [
        "files.read",
        "editor.read",
        "editor.propose",
      ],
    },
    folder: { "/notes/essay.md": "First line\n" },
    settings: { "catvinci.version-history": { every: "0" } },
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
  await expect(history.locator("#versions > li:not(.day-head)")).toHaveCount(1);
  await page.locator(editor).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" again");
  await save();
  await expect(history.locator("#versions > li:not(.day-head)")).toHaveCount(2);
  await history.locator("#versions > li:not(.day-head)").nth(1).click();
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

test("a new day's note fills in its template, and the day before is a command away", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.daily-notes": ["files.read", "files.write", "editor.read"],
    },
    folder: { "/notes/ideas.md": "# Ideas\n" },
    settings: {
      "catvinci.daily-notes": {
        template:
          "# {{date}} {{weekday}}\\n\\n[[{{yesterday}}]] · [[{{tomorrow}}]]\\n",
      },
    },
  });
  await openPath(page, "/notes/ideas.md");
  await expect(page.locator(editor)).toContainText("Ideas");
  await runCommand(page, "catvinci.daily-notes.today");
  const written = () =>
    page.evaluate(
      () => (window as unknown as { __devFs: Record<string, string> }).__devFs,
    );
  // The day is the window's own (its time zone may not be this machine's).
  await expect
    .poll(async () =>
      Object.keys(await written()).some((k) => k.includes("/Daily/")),
    )
    .toBe(true);
  const path = Object.keys(await written()).find((k) => k.includes("/Daily/"))!;
  const date = path.slice(-13, -3);
  const shift = (days: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + days));
    return at.toISOString().slice(0, 10);
  };
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en", {
    weekday: "long",
    timeZone: "UTC",
  });
  const note = (await written())[path];
  expect(note).toContain(`# ${date} ${weekday}`);
  expect(note).toContain(`[[${shift(-1)}]] · [[${shift(1)}]]`);
  await expect(page.locator(editor)).toContainText(date);
  // From that day's note, the day before.
  await runCommand(page, "catvinci.daily-notes.previous");
  await expect
    .poll(async () => Object.keys(await written()))
    .toContain(`/notes/Daily/${shift(-1)}.md`);
});

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
      "catvinci.zotero": [
        "network:localhost:23119",
        "editor.write",
        "editor.read",
      ],
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
  // Picked by the user: written at the caret at once.
  await expect(page.locator(editor)).toHaveText(/As shown\s?\[@darwin1859\]/);
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
    plugins: { "catvinci.graph": ["files.read", "editor.read"] },
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

test("Insert References List lists the works the document cites", async ({
  page,
}) => {
  const items = [
    {
      key: "ABCD1234",
      data: {
        title: "On the Origin of Species",
        creators: [
          { creatorType: "author", lastName: "Darwin", firstName: "Charles" },
        ],
        date: "1859",
        publisher: "John Murray",
        citationKey: "darwin1859",
      },
    },
  ];
  await openWithPlugins(page, {
    plugins: {
      "catvinci.zotero": [
        "network:localhost:23119",
        "editor.write",
        "editor.read",
      ],
    },
  });
  await pasteMarkdown(page, "As shown [@darwin1859], species change.");
  await mockInvoke(page, {
    plugin_http: {
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(items)).toString("base64"),
    },
  });
  await runCommand(page, "catvinci.zotero.bibliography");
  await expect(page.locator(editor)).toContainText("References");
  await expect(page.locator(editor)).toContainText(
    "Darwin, Charles (1859). On the Origin of Species. John Murray.",
  );
});
