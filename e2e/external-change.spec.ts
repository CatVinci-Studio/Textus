import { expect, test } from "@playwright/test";
import { emit, openApp, settled } from "./helpers";
import { openPath } from "./plugin-helpers";

// A file changed on disk while its tab is open and has nothing unsaved -
// another app, or an outside agent writing it mid-conversation: the editor
// takes the new text where it is, not rebuilt, so what it holds (an AI
// conversation, the undo history) goes on.

test("an open document changed on disk takes the new text in place", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/work/rain.md": "# Rain\n\nThree days of rain.\n" };
  });
  await openApp(page);
  await openPath(page, "/work/rain.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h1")).toContainText("Rain");
  await editor.evaluate((e) => ((e as HTMLElement).dataset.mark = "kept"));

  // Written elsewhere: new text, a new time.
  await page.evaluate(() => {
    const w = window as unknown as {
      __devFs: Record<string, string>;
      __devFsTimes?: Record<string, number>;
    };
    w.__devFs["/work/rain.md"] = "# Flood\n\nThree days of rain.\n";
    w.__devFsTimes = { ...w.__devFsTimes, "/work/rain.md": 99 };
    window.dispatchEvent(new Event("textus:file-written"));
  });
  await expect(editor.locator("h1")).toContainText("Flood");
  await expect(editor).toHaveAttribute("data-mark", "kept");
  // Taken as what is on disk: nothing unsaved.
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
});

test("with unsaved changes, saving over a file changed elsewhere offers to take its text instead", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/work/rain.md": "# Rain\n\nThree days of rain.\n" };
  });
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/work/rain.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Mine.");
  await page.evaluate(() => {
    const w = window as unknown as {
      __devFs: Record<string, string>;
      __devFsTimes?: Record<string, number>;
    };
    w.__devFs["/work/rain.md"] = "# Flood\n\nThree days of rain.\n";
    w.__devFsTimes = { ...w.__devFsTimes, "/work/rain.md": 99 };
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-save-file");
  });
  const dialog = page.locator(".app-dialog");
  await expect(dialog.getByRole("button")).toHaveText([
    "Cancel",
    "Reload",
    "Overwrite",
  ]);
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect(editor.locator("h1")).toContainText("Flood");
  await expect(editor).not.toContainText("Mine.");
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __devFs: Record<string, string> }).__devFs[
          "/work/rain.md"
        ],
    ),
  ).toContain("Flood");
});

test("coming back from another app leaves the document where it was read", async ({
  page,
}) => {
  const long = Array.from({ length: 200 }, (_, i) => `Line ${i}.`).join("\n\n");
  await page.addInitScript((text) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/long.md": `# Long\n\n${text}\n`,
    };
  }, long);
  await openApp(page);
  await openPath(page, "/work/long.md");
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Line 199");
  await scroller.evaluate((el) => (el.scrollTop = 600));
  // Away, then back: the webview scrolls to the caret as it gives the
  // editor its focus back.
  type Dev = { __devEmitTauriEvent(name: string, payload?: unknown): void };
  await page.evaluate(() =>
    (window as unknown as Dev).__devEmitTauriEvent("tauri://blur"),
  );
  await page.evaluate(() => {
    (window as unknown as Dev).__devEmitTauriEvent("tauri://focus");
    const el = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .editor-scroll',
    )!;
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(600);
});

test("switching between documents leaves each where it was read", async ({
  page,
}) => {
  const long = (name: string) =>
    `# ${name}\n\n${Array.from({ length: 200 }, (_, i) => `${name} line ${i}.`).join("\n\n")}\n`;
  await page.addInitScript(
    (docs) => ((window as unknown as Record<string, unknown>).__devFs = docs),
    { "/work/a.md": long("A"), "/work/b.md": long("B") },
  );
  await openApp(page);
  const active = page.locator('[data-active-tab="true"]');
  const scroller = active.locator(".editor-scroll");
  const top = () => scroller.evaluate((el) => Math.round(el.scrollTop));
  const read = async (path: string, last: string, by: number) => {
    await openPath(page, path);
    await expect(active.locator(".ProseMirror")).toContainText(last);
    await settled(page);
    await scroller.hover();
    await page.mouse.wheel(0, by);
    await expect.poll(top).toBeGreaterThan(by / 2);
    // Kept once the scrolling settles.
    await settled(page);
    return top();
  };
  const a = await read("/work/a.md", "A line 199", 1500);
  const b = await read("/work/b.md", "B line 199", 800);
  // Each comes back drawn anew; the editor taking its focus back must not
  // scroll it to the caret at the top.
  for (const [name, at] of [
    ["a.md", a],
    ["b.md", b],
    ["a.md", a],
  ] as const) {
    await page.locator(".tab-pill", { hasText: name }).click();
    await expect
      .poll(async () => Math.abs((await top()) - at))
      .toBeLessThan(40);
    await settled(page);
    expect(Math.abs((await top()) - at)).toBeLessThan(40);
  }
});

test("a narrower window keeps the paragraph that was at the top, not the offset", async ({
  page,
}) => {
  const words =
    "a long line of words that wraps again when the page narrows ".repeat(6);
  const doc = Array.from({ length: 80 }, (_, i) => `P${i} ${words}`).join(
    "\n\n",
  );
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.addInitScript(
    (d) => ((window as unknown as Record<string, unknown>).__devFs = d),
    { "/work/long.md": doc },
  );
  await openApp(page);
  // As WebKit, which keeps no scroll anchor of its own.
  await page.addStyleTag({ content: "* { overflow-anchor: none; }" });
  await openPath(page, "/work/long.md");
  const active = page.locator('[data-active-tab="true"]');
  const scroller = active.locator(".editor-scroll");
  await expect(active.locator(".ProseMirror")).toContainText("P79");
  /** The paragraph at the scroller's top. */
  const atTop = () =>
    scroller.evaluate((el) => {
      const top = el.getBoundingClientRect().top + 1;
      const p = [...el.querySelectorAll(".ProseMirror > p")].find(
        (b) => b.getBoundingClientRect().bottom > top,
      );
      return p?.textContent?.split(" ")[0];
    });
  await scroller.hover();
  await page.mouse.wheel(0, 4000);
  await expect.poll(atTop).not.toBe("P0");
  await settled(page);
  // The paragraph at the top is taken a pause after the scroll stops, not
  // on every frame of it; a slow machine is still scrolling, so it is read
  // once it stays put that long.
  let before = await atTop();
  await expect
    .poll(async () => {
      const was = before;
      // Real time: longer than EditorPane's 300 ms pause.
      await page.waitForTimeout(400);
      before = await atTop();
      return before === was;
    })
    .toBe(true);
  await page.setViewportSize({ width: 820, height: 760 });
  await expect.poll(atTop).toBe(before);
  await page.setViewportSize({ width: 1280, height: 760 });
  await expect.poll(atTop).toBe(before);
});

test("a document comes back with its caret, its undo and its redo", async ({
  page,
}) => {
  const long = (name: string) =>
    `# ${name}\n\n${Array.from({ length: 120 }, (_, i) => `${name} line ${i}.`).join("\n\n")}\n`;
  await page.addInitScript(
    (docs) => ((window as unknown as Record<string, unknown>).__devFs = docs),
    { "/work/a.md": long("A"), "/work/b.md": long("B") },
  );
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  const tab = (name: string) => page.locator(".tab-pill", { hasText: name });
  const away = async () => {
    await tab("b.md").click();
    await expect(editor).toContainText("B line 119");
    await settled(page);
    await tab("a.md").click();
    await expect(editor).toContainText("A line 119");
    await settled(page);
  };
  await openPath(page, "/work/b.md");
  await openPath(page, "/work/a.md");
  await expect(editor).toContainText("A line 119");
  const line = editor.locator("p", { hasText: "A line 60." });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ONE");
  // Past the editor's undo grouping (500 ms): the two words undo apart.
  await page.waitForTimeout(700);
  await page.keyboard.type(" TWO");
  await expect(line).toHaveText("A line 60. ONE TWO");
  await settled(page);
  const read = await scroller.evaluate((el) => Math.round(el.scrollTop));

  // The caret is where it was: typing goes on after the last word, with
  // no click, and the page has not moved.
  await away();
  await page.keyboard.type("!");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60. ONE TWO!",
  );
  expect(
    Math.abs((await scroller.evaluate((el) => el.scrollTop)) - read),
  ).toBeLessThan(40);

  // Undo goes back step by step, staying at the edit; redo comes back
  // after another switch.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60. ONE",
  );
  expect(
    Math.abs((await scroller.evaluate((el) => el.scrollTop)) - read),
  ).toBeLessThan(40);
  await away();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60. ONE TWO",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60. ONE",
  );

  // Saved, closed and opened again: its history comes from its file.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tab("a.md")).toHaveCount(0);
  await openPath(page, "/work/a.md");
  await expect(editor).toContainText("A line 60. ONE");
  await settled(page);
  await editor.locator("p", { hasText: "A line 0." }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60.",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor.locator("p", { hasText: "A line 60." })).toHaveText(
    "A line 60. ONE TWO",
  );
});

test("the editor taking the focus scrolls nothing; typing brings the caret into sight", async ({
  page,
}) => {
  const text = Array.from({ length: 200 }, (_, i) => `Line ${i}.`).join("\n\n");
  await page.addInitScript((body) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/long.md": `# Long\n\n${body}\n`,
    };
  }, text);
  await openApp(page);
  await openPath(page, "/work/long.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await expect(editor).toContainText("Line 199");
  // The caret far down, the page read back at its top.
  await editor.locator("p", { hasText: /^Line 150\.$/ }).click();
  await scroller.hover();
  await page.mouse.wheel(0, -20000);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await settled(page);
  // Real time: ProseMirror takes a focus within 300 ms of a click as the
  // click's own, and keeps the caret the browser placed.
  await page.waitForTimeout(300);
  // Focus given to the element itself, the page's selection gone meanwhile
  // (a menu or a dialog took it): the browser starts the caret at the top,
  // and the editor, putting its own back, must not scroll to it.
  await editor.evaluate((el: HTMLElement) => {
    el.blur();
    getSelection()?.removeAllRanges();
    el.focus({ preventScroll: true });
  });
  await settled(page);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.type("!");
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  await expect(editor.locator("p", { hasText: "Line 150." })).toHaveText(
    "Line 150.!",
  );
});

test("a document shown again in the island not in use is where it was read", async ({
  page,
}) => {
  const long = (name: string) =>
    `# ${name}\n\n${Array.from({ length: 200 }, (_, i) => `${name} line ${i}.`).join("\n\n")}\n`;
  await page.addInitScript(
    (docs) => ((window as unknown as Record<string, unknown>).__devFs = docs),
    { "/work/a.md": long("A"), "/work/b.md": long("B") },
  );
  await page.setViewportSize({ width: 1400, height: 780 });
  await openApp(page);
  await openPath(page, "/work/a.md");
  const front = page.locator('[data-active-tab="true"]');
  await expect(front.locator(".ProseMirror")).toContainText("A line 199");
  await settled(page);
  await front.locator(".editor-scroll").hover();
  await page.mouse.wheel(0, 1500);
  await expect
    .poll(() => front.locator(".editor-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  await settled(page);
  await openPath(page, "/work/b.md");
  await expect(front.locator(".ProseMirror")).toContainText("B line 199");
  // b.md takes an island of its own: a.md comes back in the one left
  // behind, which is not the one in use.
  await emit(page, "menu-split-right");
  const a = page.locator(".editor-scroll:visible", { hasText: "A line 199" });
  await expect(a).toHaveCount(1);
  await expect(front.locator(".ProseMirror")).toContainText("B line 199");
  await expect
    .poll(async () => Math.abs((await a.evaluate((el) => el.scrollTop)) - 1500))
    .toBeLessThan(40);
});

test("a tracked document keeps its original while another tab is in front, through an autosave", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/a.md": "# A\n\nThe first line.\n",
      "/work/b.md": "# B\n\nAnother file.\n",
    };
  });
  await openApp(page, { settings: { autosave: true } });
  await openPath(page, "/work/b.md");
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("The first line.");
  await editor.locator("p").click();
  await expect(editor).toBeFocused();
  await emit(page, "menu-track-changes");
  await page.keyboard.press("End");
  await page.keyboard.type(" Added words.");
  await expect(editor.locator(".own-insert")).toContainText("Added words.");
  const file = () =>
    page.evaluate(
      () =>
        (window as unknown as { __devFs: Record<string, string> }).__devFs[
          "/work/a.md"
        ],
    );

  // Its tab out of sight, the autosave writes the original, not the change
  // nobody decided on.
  await page.locator(".tab-pill", { hasText: "b.md" }).click();
  await expect(editor).toContainText("Another file.");
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
  expect(await file()).not.toContain("Added words.");

  // Back in front, it is still tracked: the change shows, undecided.
  await page.locator(".tab-pill", { hasText: "a.md" }).click();
  await expect(editor.locator(".own-insert")).toContainText("Added words.");
  expect(await file()).not.toContain("Added words.");
});
