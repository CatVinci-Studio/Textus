import { expect, test, type Page } from "@playwright/test";
import { PHONE, openPhone } from "./helpers";

// The phone's dialogs, menus and bars (mobile/styles/chrome.css), checked in
// Chromium with touch and a phone-sized viewport (see PHONE in helpers.ts).
test.use(PHONE);

async function menuItem(page: Page, name: string) {
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name }).tap();
}

test("a confirm is an iOS alert: a narrow centred card over the whole screen", async ({
  page,
}) => {
  await openPhone(page);
  // The module the app itself imported - Vite serves it once - so this is
  // the same queue AppDialogHost shows.
  const answer = page.evaluate(async () => {
    const url = "/src/ui/app-dialog.tsx";
    const dialogs = await import(/* @vite-ignore */ url);
    return dialogs.showConfirm("“Notes.md” will be deleted.", {
      title: "Delete",
      okLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });
  });

  const dialog = page.getByRole("dialog", { name: "Delete" });
  await expect(dialog).toBeVisible();
  const card = (await dialog.boundingBox())!;
  expect(card.width).toBe(270);
  expect(Math.round(card.x + card.width / 2)).toBe(215);

  // The dimming covers the title row too.
  const overlay = (await page.locator(".close-prompt-overlay").boundingBox())!;
  expect(overlay).toMatchObject({ y: 0, height: 932 });

  // Two answers side by side, each a full-height row of text.
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const remove = dialog.getByRole("button", { name: "Delete" });
  const cancelBox = (await cancel.boundingBox())!;
  const removeBox = (await remove.boundingBox())!;
  expect(cancelBox.y).toBe(removeBox.y);
  expect(cancelBox.height).toBeGreaterThanOrEqual(44);
  expect(cancelBox.width + removeBox.width).toBeGreaterThan(265);
  // Destructive in red, bold as the expected answer; nothing focused.
  const danger = await remove.evaluate((el) => {
    const probe = el.appendChild(document.createElement("span"));
    probe.style.color = "var(--danger)";
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(remove).toHaveCSS("color", danger);
  await expect(remove).toHaveCSS("font-weight", "600");
  await expect(cancel).toHaveCSS("font-weight", "400");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BUTTON",
  );

  await cancel.tap();
  await expect(dialog).toHaveCount(0);
  expect(await answer).toBe(false);
});

test("find and replace spans the screen under the title row", async ({
  page,
}) => {
  await openPhone(page);
  await menuItem(page, "Find & Replace…");
  const bar = (await page.locator(".find-replace-bar").boundingBox())!;
  expect(bar).toMatchObject({ x: 0, y: 44, width: 430 });
  // 44pt to hit; the replace row opens under it as on the desktop.
  const close = (await page
    .getByRole("button", { name: "Close find bar" })
    .boundingBox())!;
  expect(close.height).toBeGreaterThanOrEqual(44);
  await page.locator(".find-replace-chevron").tap();
  await expect(page.locator(".find-replace-row")).toHaveCount(2);

  // The menu opens over the find bar.
  await page.locator(".window-menu-button").tap();
  const first = page.getByRole("menuitem", { name: "Documents" });
  const box = (await first.boundingBox())!;
  // What a tap on the first row would land on: the row, not the find bar.
  const hit = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest("[role=menuitem]")
        ?.textContent ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe("Documents");
});

test("tabs have a close button a finger can hit; closing an edited tab asks with an action sheet", async ({
  page,
}) => {
  await openPhone(page);
  await menuItem(page, "New File");
  const closes = page.locator(".tab-pill-close");
  await expect(closes).toHaveCount(2);
  for (const box of [
    await closes.nth(0).boundingBox(),
    await closes.nth(1).boundingBox(),
  ]) {
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const pill = (await page.locator(".tab-pill").first().boundingBox())!;
  expect(pill.height).toBeGreaterThanOrEqual(36);

  // Edited, it asks before it closes.
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.type("draft");
  await page.locator(".tab-pill-active .tab-pill-close").tap();

  const sheet = page.getByRole("menu", {
    name: "This document has unsaved changes.",
  });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("menuitem")).toHaveText(["Save", "Don't Save"]);
  // Cancel keeps the tab; Don't Save closes it.
  await sheet.getByRole("button", { name: "Cancel" }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".tab-pill")).toHaveCount(2);

  await page.locator(".tab-pill-active .tab-pill-close").tap();
  await sheet.getByRole("menuitem", { name: "Don't Save" }).tap();
  await expect(page.locator(".tab-pill")).toHaveCount(0);
});

test("the menu is a pull-down menu and a tap beside it closes it", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  const list = page.locator(".app-menu-list");
  await expect(list).toBeVisible();
  expect((await list.boundingBox())!.width).toBe(250);
  const row = (await page.getByRole("menuitem").first().boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(44);
  // No row starts out looking selected.
  expect(
    await page.evaluate(() => document.activeElement?.closest(".app-menu")),
  ).toBeNull();

  // A tap on the page's text, which sends no mousedown on iOS.
  await page.tap(".main-pane", { position: { x: 380, y: 600 } });
  await expect(list).toHaveCount(0);
});

test("a full-screen page covers the find bar but not its own alerts", async ({
  page,
}) => {
  await openPhone(page);
  await menuItem(page, "Find & Replace…");
  await menuItem(page, "Settings…");
  const hitAt = (x: number, y: number) =>
    page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest(".settings-panel, .find-replace-bar")?.className ?? null,
      { x, y },
    );
  // Where the find bar sits, under the title row: Settings is on top.
  expect(await hitAt(215, 66)).toContain("settings-panel");
  // A clear asks first, and the question is over Settings, not behind it.
  await page.getByRole("button", { name: "Privacy" }).tap();
  await page.getByRole("button", { name: "Clear" }).first().tap();
  const alert = page.getByRole("dialog", { name: "Clear Chat History" });
  await expect(alert).toBeVisible();
  const box = (await alert.boundingBox())!;
  expect(
    await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".app-dialog"),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ),
  ).toBe(true);
});
