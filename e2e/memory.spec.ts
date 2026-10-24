import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * The AI panel's Memory tab and the project files it opens (.textus/):
 * each opens as a document of its own, in a new tab beside the one being
 * written.
 */

const ENTRY_PATH = "/notes/.textus/library/Lin.md";

const workspace = (library: unknown[]) => ({
  instructions: [],
  project_instructions: "",
  skills: [],
  root: "/notes",
  style: null,
  library,
  memories: { items: [], chars: 0, cap: 4000 },
  remember: true,
});

async function createEntry(page: Page, name: string) {
  await page.locator("#agent-tab-memory").click();
  await page
    .locator(".memory-section", { hasText: "Library" })
    .getByRole("button", { name: "New" })
    .click();
  await page.getByPlaceholder("Name of a character, place or term").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

test("a new library entry opens in a tab with the panel still on Memory, its template's comment a note, not markup", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  // What projectLibraryTemplate writes (i18n/locales/en.ts).
  const note =
    "Facts Textus AI should keep consistent whenever Lin or an alias comes up. Comments like this one are never sent.";
  await mockInvoke(page, {
    load_agent_workspace: workspace([]),
    ensure_project_file: ENTRY_PATH,
    read_text_file: `---\nname: Lin\naliases: []\ninclude: detected\n---\n\n<!-- ${note} -->\n\n`,
  });
  await createEntry(page, "Lin");
  // The entry opened in a tab of its own...
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  // ...and the panel, now drawn by that tab's editor, is still on Memory.
  await expect(page.locator("#agent-tab-memory")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".agent-panel-memory")).toBeVisible();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator(".raw-html-comment")).toHaveText(note);
  await expect(editor).not.toContainText("<!--", { useInnerText: true });
  // The caret on it gives the markup back, to edit.
  await editor.locator(".raw-html-comment").click();
  await expect(editor).toContainText(`<!-- ${note} -->`, {
    useInnerText: true,
  });
  await expect(editor.locator(".raw-html-comment")).toHaveCount(0);
});

// ---------------------------------------------------------------- remember

/** What the remember tool returns when it saved something (ai/memory.rs's
 *  Remembering). */
const REMEMBERED = {
  remembered: "project/memory/Use-British-spelling",
  scope: "project",
  created: true,
  text: "Use British spelling.",
  previous: null,
  note: "Saved.",
};

const memoryWorkspace = (remember = true) => ({
  ...workspace([]),
  remember,
  memories: {
    items: remember
      ? [
          {
            id: REMEMBERED.remembered,
            scope: "project",
            kind: "requirement",
            text: REMEMBERED.text,
            file: "/notes/.textus/memory/Use-British-spelling.md",
            remembered: {
              created: "2026-10-18T09:30:00Z",
              updated: "2026-10-18T09:30:00Z",
              conversation: "c-1",
              title: "Always use British spelling",
              document: "/notes/draft.md",
            },
            included: true,
          },
        ]
      : [],
    chars: 21,
    cap: 4000,
  },
});

const LIBRARY_USE = {
  included: [],
  leftOut: [],
  lastRequest: false,
  cap: 8000,
};

/** The calls a canned command answered (window.__devInvokeCalls). */
async function calls(page: Page, cmd: string) {
  return page.evaluate(
    (name) =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === name),
    cmd,
  );
}

test("what Textus AI remembers shows under its reply, and Undo takes it back", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const message = "Always use British spelling";
  await mockInvoke(page, {
    load_agent_workspace: memoryWorkspace(),
    library_use: LIBRARY_USE,
    ai_agent_message: [
      { kind: "User", text: message },
      { kind: "Assistant", text: "Noted - British spelling from now on." },
    ],
    // After the reply, apart from it (ai/memory/pass.rs).
    memory_pass: [REMEMBERED],
    memory_undo: null,
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");

  const chip = page.locator(".agent-memory-chip");
  await expect(chip).toContainText(
    "Remembered: Use British spelling. (project)",
  );
  // The pass read the exchange, and named its conversation for the
  // memory's record.
  const [passed] = await calls(page, "memory_pass");
  expect(passed).toMatchObject({
    conversation: { title: message },
    exchange: {
      messages: [message],
      reply: "Noted - British spelling from now on.",
    },
  });
  // The chip sits under the reply it came after.
  await expect(
    page.locator(".agent-panel-view").getByText("Noted - British spelling"),
  ).toBeVisible();

  // A click on what it says opens the Memory tab at it, marked.
  await chip.locator(".agent-memory-chip-line").click();
  const remembered = page.locator(
    `[data-memory-id="${REMEMBERED.remembered}"]`,
  );
  await expect(remembered).toBeVisible();
  await expect(remembered).toHaveClass(/motion-mark/);
  await expect(remembered).toContainText(REMEMBERED.text);
  await page.getByRole("tab", { name: "Chat" }).click();

  await chip.getByRole("button", { name: "Undo" }).click();
  await expect(chip).toHaveText("Undone. No longer remembered.");
  expect(await calls(page, "memory_undo")).toEqual([
    expect.objectContaining({ id: REMEMBERED.remembered, previous: null }),
  ]);
});

test("with Remember automatically off, nothing is asked after the reply", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", rememberAutomatically: false },
    storage: { "textus-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    load_agent_workspace: memoryWorkspace(false),
    library_use: LIBRARY_USE,
    ai_agent_message: [
      { kind: "User", text: "Always use British spelling" },
      { kind: "Assistant", text: "Done." },
    ],
    memory_pass: [REMEMBERED],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Always use British spelling");
  await composer.press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText("Done.");
  expect(await calls(page, "memory_pass")).toEqual([]);
  await expect(page.locator(".agent-memory-chip")).toHaveCount(0);
});

test("the Memory tab lists what was remembered, and moves and deletes it", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    load_agent_workspace: memoryWorkspace(),
    library_use: LIBRARY_USE,
    memory_move: "personal/memory/Use-British-spelling",
    memory_delete: null,
  });
  await page.locator("#agent-tab-memory").click();
  const remembered = page.locator(".memory-remembered");
  await expect(remembered).toContainText("This project");
  await expect(remembered).toContainText(REMEMBERED.text);
  await expect(remembered).toContainText("from “Always use British spelling”");

  await remembered.getByRole("button", { name: "Make global" }).click();
  await expect
    .poll(async () => (await calls(page, "memory_move")).length)
    .toBe(1);
  expect((await calls(page, "memory_move"))[0]).toMatchObject({
    id: REMEMBERED.remembered,
    scope: "personal",
  });

  await remembered.getByRole("button", { name: "Delete" }).click();
  // Asked first.
  const dialog = page.getByRole("dialog", { name: /Delete this memory/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () => (await calls(page, "memory_delete")).length)
    .toBe(1);
  expect((await calls(page, "memory_delete"))[0]).toMatchObject({
    id: REMEMBERED.remembered,
  });
});

test("with Remember automatically off, the Memory tab says so", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", rememberAutomatically: false },
    storage: { "textus-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    load_agent_workspace: memoryWorkspace(false),
    library_use: LIBRARY_USE,
  });
  await page.locator("#agent-tab-memory").click();
  await expect(page.locator(".memory-remembered")).toContainText(
    "Remember automatically is off",
  );
});

test("a request worth doing again is offered as a skill, saved only when asked", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const message =
    "Turn my notes into the weekly report: three sections - Done, Next, Risks - one line each, no names.";
  await mockInvoke(page, {
    load_agent_workspace: memoryWorkspace(),
    library_use: LIBRARY_USE,
    ai_agent_message: [
      { kind: "User", text: message },
      { kind: "Assistant", text: "Here is the report." },
    ],
    memory_pass: [],
    // After the reply (ai/memory/skill_offer.rs).
    ai_offer_skill: {
      name: "Weekly-report",
      description: "Turns notes into the weekly report.",
      instructions:
        "Three sections: Done, Next, Risks. One line each, no names.",
    },
    save_offered_skill: "/home/me/.config/textus/skills/Weekly-report.md",
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
  const chip = page.locator(".skill-offer-chip");
  await expect(chip).toContainText("Keep this as a skill, /Weekly-report?");
  await expect(chip).toContainText("Turns notes into the weekly report.");
  // Nothing is saved until asked.
  expect(await calls(page, "save_offered_skill")).toEqual([]);
  const [asked] = await calls(page, "ai_offer_skill");
  expect(asked).toMatchObject({ exchange: { messages: [message] } });
  await chip.getByRole("button", { name: "Save for every document" }).click();
  await expect(chip).toContainText("Kept as /Weekly-report");
  expect(await calls(page, "save_offered_skill")).toEqual([
    expect.objectContaining({
      scope: "personal",
      offer: expect.objectContaining({ name: "Weekly-report" }),
    }),
  ]);
});
