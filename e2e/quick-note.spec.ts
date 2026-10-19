import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Quick Notes: the Quick Note window (?view=quick-note, src/quick-note/)
// against canned commands standing in for src-tauri/src/commands/
// quick_note/, its row in Settings › General, and what an editor window
// does when a note lands in a file it has open.

// The page's user agent is Windows Chrome's (playwright.config.ts), so the
// shortcuts read as Windows writes them: Win+Alt+N is the default there.

// English labels, as in src/i18n/locales/en.ts.
const t = {
  quickNotesGroup: "Quick Notes",
  shortcutToggle: "Global shortcut",
  shortcutLabel: "Shortcut",
  inApp: "Textus uses this combination itself. Choose another.",
  draftRestored: "Restored the note you hadn't saved.",
  continuing: "Continuing your last note.",
  discard: "Discard",
  openInTextus: "Open in Textus",
  commandCopy: "Copy",
};

const NOTE_EDITOR = ".quick-note .ProseMirror";

interface Call {
  cmd: string;
  [arg: string]: unknown;
}

const calls = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as { __devInvokeCalls?: Call[] }).__devInvokeCalls ??
        []) as Call[],
  );

const called = async (page: Page, cmd: string) =>
  (await calls(page)).filter((c) => c.cmd === cmd);

/** Every Quick Note command answered, so each call is recorded. */
function quickNoteResults(session: unknown = { draft: null, last: null }) {
  return {
    quick_note_session: session,
    quick_note_commit: "/home/me/Documents/Textus/Quick Notes/Note.md",
    quick_note_finish: null,
    quick_note_save_draft: null,
    quick_note_discard_draft: null,
    quick_note_preview_name: "Note.md",
    quick_note_open_in_editor: null,
    quick_note_ready: 120,
  };
}

async function openQuickNote(page: Page, session?: unknown) {
  const results = quickNoteResults(session);
  await page.addInitScript((r) => {
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({
        language: "en",
        languageChosen: true,
        onboardingShown: true,
      }),
    );
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      r;
  }, results);
  await page.goto("/?view=quick-note");
  await expect(page.locator(NOTE_EDITOR)).toBeVisible();
}

test.describe("the Quick Note window", () => {
  test("opens on its own, with the editor ready to type in", async ({
    page,
  }) => {
    await openQuickNote(page);
    // The editor window's App never loads here.
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(page.locator(NOTE_EDITOR)).toBeFocused();
    await expect
      .poll(async () => (await called(page, "quick_note_ready")).length)
      .toBe(1);
    await expect(page.locator(".quick-note-target")).toHaveText(
      "Quick Note → Note.md",
    );
  });

  test("typing and Escape saves the note and closes the window", async ({
    page,
  }) => {
    await openQuickNote(page);
    await page.keyboard.type("Buy milk");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await called(page, "quick_note_finish")).length)
      .toBe(1);
    const [commit] = await called(page, "quick_note_commit");
    expect(String(commit.text).trim()).toBe("Buy milk");
    expect(commit.target).toBeNull();
    expect(commit.stamp).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      time: expect.stringMatching(/^\d{2}:\d{2}$/),
    });
    expect((await called(page, "quick_note_finish"))[0].back).toBe(true);
  });

  test("an empty note closes without writing anything", async ({ page }) => {
    await openQuickNote(page);
    await page.keyboard.type("   ");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await called(page, "quick_note_finish")).length)
      .toBe(1);
    expect(await called(page, "quick_note_commit")).toEqual([]);
    expect((await called(page, "quick_note_discard_draft")).length).toBe(1);
  });

  for (const key of ["ControlOrMeta+Enter", "ControlOrMeta+s"])
    test(`${key} saves and closes too`, async ({ page }) => {
      await openQuickNote(page);
      await page.keyboard.type("A thought");
      await page.keyboard.press(key);
      await expect
        .poll(async () => (await called(page, "quick_note_commit")).length)
        .toBe(1);
      expect((await called(page, "quick_note_finish")).length).toBe(1);
    });

  test("Escape while an input method composes leaves the window open", async ({
    page,
  }) => {
    await openQuickNote(page);
    await page.keyboard.type("ni");
    await page.evaluate(() => {
      const target = document.activeElement!;
      target.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    await page.waitForTimeout(200);
    expect(await called(page, "quick_note_finish")).toEqual([]);
  });

  test("Escape closes the find bar before it closes the note", async ({
    page,
  }) => {
    await openQuickNote(page);
    await page.keyboard.type("find me");
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator(".find-replace-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".find-replace-bar")).toHaveCount(0);
    expect(await called(page, "quick_note_finish")).toEqual([]);
    await page.locator(NOTE_EDITOR).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await called(page, "quick_note_finish")).length)
      .toBe(1);
  });

  test("a draft left behind comes back, and typing keeps it", async ({
    page,
  }) => {
    await openQuickNote(page, {
      draft: { text: "Words from before the crash", target: null },
      last: null,
    });
    await expect(page.locator(NOTE_EDITOR)).toContainText(
      "Words from before the crash",
    );
    await expect(page.getByRole("status")).toHaveText(t.draftRestored);
    await page.keyboard.type(" and after");
    await expect
      .poll(async () => (await called(page, "quick_note_save_draft")).length)
      .toBeGreaterThan(0);
    const drafts = await called(page, "quick_note_save_draft");
    expect(String(drafts.at(-1)!.text)).toContain("and after");
  });

  test("the note saved a moment ago continues, and saves over itself", async ({
    page,
  }) => {
    const path = "/home/me/Documents/Textus/Quick Notes/Groceries.md";
    await openQuickNote(page, {
      draft: null,
      last: {
        path,
        heading: null,
        text: "Groceries",
        savedAtMs: Date.now() - 60_000,
      },
    });
    await expect(page.locator(NOTE_EDITOR)).toContainText("Groceries");
    await expect(page.getByRole("status")).toHaveText(t.continuing);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Milk");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await called(page, "quick_note_commit")).length)
      .toBe(1);
    const [commit] = await called(page, "quick_note_commit");
    expect(commit.target).toEqual({ path, heading: null, base: "Groceries" });
    expect(String(commit.text)).toContain("Milk");
  });

  test("an old last note starts a blank one", async ({ page }) => {
    await openQuickNote(page, {
      draft: null,
      last: {
        path: "/notes/Old.md",
        heading: null,
        text: "Old",
        savedAtMs: Date.now() - 60 * 60_000,
      },
    });
    await expect(page.locator(NOTE_EDITOR)).not.toContainText("Old");
  });

  test("Discard asks first, then closes without saving", async ({ page }) => {
    await openQuickNote(page);
    await page.keyboard.type("Never mind");
    await page.getByRole("button", { name: t.discard }).click();
    const dialog = page.locator(".app-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t.discard }).click();
    await expect
      .poll(async () => (await called(page, "quick_note_finish")).length)
      .toBe(1);
    expect(await called(page, "quick_note_commit")).toEqual([]);
  });

  test("Open in Textus saves and hands the file to an editor window", async ({
    page,
  }) => {
    await openQuickNote(page);
    await page.keyboard.type("Plan");
    await page.getByRole("button", { name: t.openInTextus }).click();
    await expect
      .poll(
        async () => (await called(page, "quick_note_open_in_editor")).length,
      )
      .toBe(1);
    expect((await called(page, "quick_note_open_in_editor"))[0].path).toBe(
      "/home/me/Documents/Textus/Quick Notes/Note.md",
    );
  });

  test("File > Save and Close Tab from the menu save the note", async ({
    page,
  }) => {
    await openQuickNote(page);
    await page.keyboard.type("From the menu");
    await page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-close-tab"),
    );
    await expect
      .poll(async () => (await called(page, "quick_note_commit")).length)
      .toBe(1);
  });
});

test.describe("Settings › General › Quick Notes", () => {
  async function openSettings(page: Page) {
    await openApp(page, { settings: { language: "en" } });
    await mockInvoke(page, {
      quick_note_folder: { path: "/home/me/Documents/Textus/Quick Notes" },
      quick_note_cli_command: "/usr/bin/textus --quick-note",
      quick_note_shortcut_status: {
        state: "off",
        accelerator: "Super+Alt+N",
        reason: null,
      },
    });
    await page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-open-settings"),
    );
    const group = page
      .locator(".settings-group")
      .filter({ has: page.getByRole("heading", { name: t.quickNotesGroup }) });
    await expect(group).toBeVisible();
    return group;
  }

  const emitStatus = (page: Page, status: unknown) =>
    page.evaluate(
      (s) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (n: string, p: unknown) => void;
          }
        ).__devEmitTauriEvent("quick-note-shortcut-status", s),
      status,
    );

  const stored = (page: Page) =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
    );

  test("the shortcut is off until switched on, then records a combination", async ({
    page,
  }) => {
    const group = await openSettings(page);
    await expect(group).toContainText("/home/me/Documents/Textus/Quick Notes");
    await expect(group).toContainText("/usr/bin/textus --quick-note");
    await expect(group.getByText(t.shortcutLabel, { exact: true })).toHaveCount(
      0,
    );
    await group.getByLabel(t.shortcutToggle).check();
    expect((await stored(page)).quickNoteShortcutEnabled).toBe(true);

    const record = group.getByRole("button", { name: /^Shortcut:/ });
    await expect(record).toHaveText("Win+Alt+N");
    // Textus's own Ctrl+Shift+K (the chat) is refused.
    await record.click();
    await page.keyboard.press("Control+Shift+KeyK");
    await expect(group.getByRole("alert")).toHaveText(t.inApp);
    await page.keyboard.press("Meta+Alt+KeyJ");
    await expect(record).toHaveText("Win+Alt+J");
    expect((await stored(page)).quickNoteShortcut).toBe("Alt+Super+J");
  });

  test("says what the OS made of the shortcut", async ({ page }) => {
    const group = await openSettings(page);
    await group.getByLabel(t.shortcutToggle).check();
    await emitStatus(page, {
      state: "on",
      accelerator: "Super+Alt+N",
      reason: null,
    });
    await expect(group.locator('[data-quick-note-status="on"]')).toHaveText(
      "On: press Win+Alt+N in any app.",
    );
    await emitStatus(page, {
      state: "inUse",
      accelerator: "Super+Alt+N",
      reason: null,
    });
    await expect(group.locator('[data-quick-note-status="inUse"]')).toHaveText(
      "Win+Alt+N is in use by another app. Choose another combination.",
    );
    await emitStatus(page, {
      state: "wayland",
      accelerator: "Super+Alt+N",
      reason: null,
    });
    await expect(
      group.locator('[data-quick-note-status="wayland"]'),
    ).toContainText("Wayland");
  });
});

test.describe("an editor window with the file open", () => {
  const PATH = "/home/me/Documents/Textus/Quick Notes/2026-10-19.md";
  const DAY = "## 09:00\n\nMorning\n";
  const ENTRY = "## 14:32\n\nAfternoon\n";
  const editor = '[data-active-tab="true"] .ProseMirror';

  async function openDay(page: Page) {
    await openApp(page, { settings: { language: "en" } });
    await page.evaluate(
      ({ path, text }) => {
        const w = window as unknown as Record<string, unknown> & {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
          };
        };
        const disk = {
          files: { [path]: { text, mtime: 1 } } as Record<
            string,
            { text: string; mtime: number }
          >,
          writes: [] as string[],
        };
        w.__disk = disk;
        const original = w.__TAURI_INTERNALS__.invoke;
        w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
          const file = disk.files[String(args.path)];
          switch (cmd) {
            case "read_text_file":
              if (file) return Promise.resolve(file.text);
              break;
            case "file_mtime_ms":
              return Promise.resolve(file?.mtime ?? null);
            case "write_text_file":
              disk.files[String(args.path)] = {
                text: String(args.contents),
                mtime: (file?.mtime ?? 0) + 1,
              };
              disk.writes.push(String(args.contents));
              return Promise.resolve(null);
          }
          return original(cmd, args);
        };
        (w.__devEmitTauriEvent as (name: string, payload: unknown) => void)(
          "tauri://drag-drop",
          { paths: [path], position: { x: 0, y: 0 } },
        );
      },
      { path: PATH, text: DAY },
    );
    await expect(page.locator(editor)).toContainText("Morning");
  }

  /** What Rust does on a quick note's save: the file changes, and every
   *  editor window hears of it. */
  const writeNote = (
    page: Page,
    written: { before: string; after: string; entry: string | null },
  ) =>
    page.evaluate(
      ({ path, written }) => {
        const w = window as unknown as {
          __disk: { files: Record<string, { text: string; mtime: number }> };
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        };
        const file = w.__disk.files[path];
        w.__disk.files[path] = { text: written.after, mtime: file.mtime + 1 };
        w.__devEmitTauriEvent("quick-note-written", { path, ...written });
      },
      { path: PATH, written },
    );

  test("a tab without unsaved edits shows the note at once", async ({
    page,
  }) => {
    await openDay(page);
    await writeNote(page, {
      before: DAY,
      after: `${DAY}\n${ENTRY}`,
      entry: ENTRY,
    });
    await expect(page.locator(editor)).toContainText("Afternoon");
    await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  });

  test("unsaved edits take in an appended entry and keep both", async ({
    page,
  }) => {
    await openDay(page);
    await page.locator(`${editor} p`).last().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and coffee");
    await writeNote(page, {
      before: DAY,
      after: `${DAY}\n${ENTRY}`,
      entry: ENTRY,
    });
    await expect(page.locator(editor)).toContainText("Afternoon");
    await expect(page.locator(editor)).toContainText("Morning and coffee");
    await expect(page.locator(".unsaved-dot")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() =>
        page.evaluate(
          (path) =>
            (
              window as unknown as {
                __disk: { files: Record<string, { text: string }> };
              }
            ).__disk.files[path].text,
          PATH,
        ),
      )
      .toContain("Morning and coffee");
    const text = await page.evaluate(
      (path) =>
        (
          window as unknown as {
            __disk: { files: Record<string, { text: string }> };
          }
        ).__disk.files[path].text,
      PATH,
    );
    expect(text).toContain("Afternoon");
  });

  test("otherwise the save asks first, naming the quick note", async ({
    page,
  }) => {
    await openDay(page);
    await page.locator(`${editor} p`).last().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and coffee");
    // A continued entry rewritten in place: nothing to merge.
    await writeNote(page, {
      before: DAY,
      after: "## 09:00\n\nMorning, continued from the shortcut\n",
      entry: null,
    });
    await page.waitForTimeout(200);
    await expect(page.locator(editor)).toContainText("Morning and coffee");
    await page.keyboard.press("ControlOrMeta+s");
    const dialog = page.locator(".app-dialog");
    await expect(dialog).toContainText("A quick note was saved into this file");
    await expect(dialog).toContainText("Morning, continued from the shortcut");
  });
});
