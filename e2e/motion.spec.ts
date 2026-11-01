import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PHONE,
  mockInvoke,
  openApp,
  openPhone,
  pasteMarkdown,
} from "./helpers";
import { STORY, STORY_CLASSICAL } from "./revise-mock";

// Motion with the animations on: surfaces still open and close, nothing
// stays mounted after its exit (it would leave an inert layer over the app),
// and reduced motion turns travel and scale into plain fades.

/** Longest exit plus margin: a closed surface must be gone by then. */
const GONE = { timeout: 600 };

async function emit(page: Page, name: string) {
  await page.evaluate(
    (event) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(event),
    name,
  );
}

/** Waits until nothing in the element is animating any more. */
async function settled(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    )
    .toBe(0);
}

/** Every transform `selector` shows over the next `ms`, one per frame,
 *  starting at once - for watching an entrance as it plays. */
function sampleTransforms(page: Page, selector: string, ms = 300) {
  return page.evaluate(
    ({ selector, ms }) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const start = performance.now();
        const frame = () => {
          const el = document.querySelector(selector);
          if (el) seen.push(getComputedStyle(el).transform);
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(seen);
        };
        frame();
      }),
    { selector, ms },
  );
}

const IDENTITY = new Set(["none", "matrix(1, 0, 0, 1, 0, 0)"]);

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`animations on, ${reducedMotion} motion`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
    });

    test("a menu, Settings and a Select in it open and close", async ({
      page,
    }) => {
      await openApp(page, { animations: true });
      await page.locator(".window-menu-button").click();
      const menu = page.locator(".app-menu-list");
      await expect(menu).toBeVisible();
      await settled(menu);
      await expect(menu).toHaveCSS("opacity", "1");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0, GONE);

      await emit(page, "menu-open-settings");
      await expect(page.locator(".settings-panel")).toBeVisible();
      // Its keys work during the entrance, as soon as it has the focus
      // (moved in an effect, a frame after it first shows).
      await expect
        .poll(() =>
          page.evaluate(
            () => !!document.activeElement?.closest(".settings-panel"),
          ),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(".settings-backdrop")).toHaveCount(0, GONE);

      await emit(page, "menu-open-settings");
      await page.getByRole("button", { name: "编辑与外观" }).click();
      // Playwright retries a click on a moving target with other scroll
      // alignments, and a scroll closes a Select: let the page settle.
      await settled(page.locator(".settings-panel"));
      const select = page.getByRole("combobox", { name: "图片存储位置" });
      await select.scrollIntoViewIfNeeded();
      await settled(page.locator(".settings-panel"));
      await select.click();
      const list = page.getByRole("listbox");
      await expect(list).toBeVisible();
      await settled(list);
      // A choice acts at once, while the list is still on its way out.
      await list.getByRole("option", { name: "上传到图床" }).click();
      await expect(select).toContainText("上传到图床");
      await expect(list).toHaveCount(0, GONE);
    });

    test("a confirm dialog answers and leaves", async ({ page }) => {
      await openApp(page, { animations: true });
      const answer = page.evaluate(async () => {
        const url = "/src/ui/app-dialog.tsx";
        const dialogs = await import(/* @vite-ignore */ url);
        return dialogs.showConfirm("Delete it?", {
          title: "Delete",
          okLabel: "Delete",
          cancelLabel: "Cancel",
          danger: true,
        });
      });
      const dialog = page.getByRole("dialog", { name: "Delete" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(await answer).toBe(false);
      await expect(page.locator(".close-prompt-overlay")).toHaveCount(0, GONE);
    });

    test("the AI panel plays its exit, inert, then unmounts", async ({
      page,
    }) => {
      await openApp(page, { animations: true });
      const toggle = page.locator(".window-bar-toggle");
      await toggle.click();
      const panel = page.locator(".agent-panel");
      await expect(page.locator(".agent-panel-view")).toBeVisible();
      await settled(panel);
      await toggle.click();
      await expect(panel).toHaveAttribute("data-state", "closing");
      await expect(panel).toHaveAttribute("inert", "");
      await expect(panel).toHaveCount(0, GONE);
      // And it comes back: toggled again, it opens as before.
      await toggle.click();
      await expect(page.locator(".agent-panel-view")).toBeVisible();
    });
  });

  test.describe(`phone, animations on, ${reducedMotion} motion`, () => {
    test.use(PHONE);
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
    });

    test("Settings and the AI sheet open and close", async ({ page }) => {
      await openPhone(page, { animations: true });
      await page.locator(".window-menu-button").tap();
      await page.getByRole("menuitem", { name: "Settings…" }).tap();
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expect(settings).toBeVisible();
      await settled(page.locator(".settings-backdrop"));
      // The desktop's card, inside the screen's edges.
      expect((await settings.boundingBox())!.width).toBe(430 - 16);
      await page.getByRole("button", { name: "Close" }).tap();
      await expect(page.locator(".settings-backdrop")).toHaveCount(0, GONE);

      await page.locator(".window-bar-toggle").tap();
      const sheet = page.locator(".agent-panel");
      await expect(sheet).toBeVisible();
      await settled(sheet);
      const box = (await sheet.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(932);
      await page.locator(".window-bar-toggle").tap();
      await expect(sheet).toHaveCount(0, GONE);
    });
  });
}

test("reopened during its exit, the find bar takes the focus again", async ({
  page,
}) => {
  await openApp(page, { animations: true });
  await emit(page, "menu-find-replace");
  const input = page.locator(".find-replace-bar input").first();
  await expect(input).toBeFocused();
  // Closed, and opened again two frames later - well inside the 120ms
  // exit, with the closing bar on screen: a fresh bar comes, not the one
  // going out (which no longer takes the focus).
  const reopened = await page.evaluate(async () => {
    const emit = (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent;
    const frame = () => new Promise(requestAnimationFrame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await frame();
    await frame();
    const closing = !!document.querySelector(
      '.find-replace-bar[data-state="closing"]',
    );
    emit("menu-find-replace");
    return closing;
  });
  expect(reopened).toBe(true);
  await expect(page.locator(".find-replace-bar")).toHaveCount(1, GONE);
  await expect(page.locator(".find-replace-bar")).toHaveAttribute(
    "data-state",
    "open",
  );
  await expect(input).toBeFocused();
});

test("the text column glides aside for the margin, on its transform", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    animations: true,
    settings: { language: "en", revisionDisplay: "original" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, STORY);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: STORY,
          text: STORY_CLASSICAL,
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const column = '[data-active-tab="true"] > .editor-scroll > .editor-content';
  const sampling = sampleTransforms(page, column, 900);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Classical Chinese, please");
  await composer.press("Enter");
  const frames = await sampling;
  // The beside-the-panel window makes room by moving the column at once and
  // sliding it, not by laying the text out again every frame.
  await expect(page.locator(".revision-note").first()).toBeVisible();
  expect(
    await page
      .locator(column)
      .evaluate((el) => (el as HTMLElement).style.marginLeft),
  ).not.toBe("");
  expect(frames.some((t) => !IDENTITY.has(t))).toBe(true);
  expect(IDENTITY.has(frames.at(-1)!)).toBe(true);
});

test("the find bar keeps clear of the docked AI panel", async ({ page }) => {
  await openApp(page, { animations: true });
  await page.locator(".window-bar-toggle").click();
  const panel = page.locator(".agent-panel");
  await settled(panel);
  await emit(page, "menu-find-replace");
  const bar = page.locator(".find-replace-bar");
  await settled(bar);
  const panelBox = (await panel.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(Math.round(panelBox.x - (barBox.x + barBox.width))).toBe(24);
  // Told to the bar itself: on the app's shell, the whole window would inherit
  // it and restyle every element whenever it changed.
  expect(
    await page
      .locator(".app-shell")
      .evaluate((el) =>
        (el as HTMLElement).style.getPropertyValue("--docked-panel-width"),
      ),
  ).toBe("");
});

test.describe("reduced motion", () => {
  test("turns travel and scale into fades", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page, { animations: true });
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--motion-distance-sm")
          .trim(),
      ),
    ).toBe("0px");

    // A menu fades in where it rests: no frame of its entrance is scaled.
    const sampling = sampleTransforms(page, ".app-menu-list");
    await page.locator(".window-menu-button").click();
    const menuFrames = await sampling;
    expect(menuFrames.length).toBeGreaterThan(0);
    expect(menuFrames.filter((t) => !IDENTITY.has(t))).toEqual([]);
    await page.keyboard.press("Escape");

    // The AI panel arrives in place rather than sliding in.
    const panelSampling = sampleTransforms(page, ".agent-panel");
    await page.locator(".window-bar-toggle").click();
    const panelFrames = await panelSampling;
    expect(panelFrames.length).toBeGreaterThan(0);
    expect(panelFrames.filter((t) => !IDENTITY.has(t))).toEqual([]);
  });

  test("without it, the same entrances do move", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page, { animations: true });
    const sampling = sampleTransforms(page, ".app-menu-list");
    await page.locator(".window-menu-button").click();
    const frames = await sampling;
    expect(frames.some((t) => !IDENTITY.has(t))).toBe(true);
  });
});
