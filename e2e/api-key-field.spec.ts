import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * A key's field in Settings shows the key masked (first six and last four
 * characters around ***) and saves the key itself.
 */

const key = "tvly-dev-0123456789abcdefghijklmnopqrstuvwxyz";

async function keyField(page: Page) {
  await openApp(page, { settings: { language: "en", aiProvider: "deepseek" } });
  await mockInvoke(page, {
    web_search_status: { native: false, service: null },
    provider_api_key_status: false,
    set_provider_api_key: null,
  });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Textus AI", exact: true }).click();
  await panel.getByRole("combobox", { name: "Search service" }).click();
  await page.getByRole("option", { name: "Tavily" }).click();
  return { panel, field: panel.getByLabel("Tavily API key") };
}

/** A paste, as the system's ⌘V sends it. */
async function paste(field: Locator, text: string) {
  await field.focus();
  await field.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

async function saved(page: Page, panel: Locator) {
  await panel
    .locator(".settings-row", { hasText: "Tavily API key" })
    .getByRole("button", { name: "Save" })
    .click();
  return page.evaluate(
    () =>
      (
        (
          window as unknown as {
            __devInvokeCalls?: { cmd: string; key?: string }[];
          }
        ).__devInvokeCalls ?? []
      ).filter((c) => c.cmd === "set_provider_api_key")[0]?.key,
  );
}

test("a pasted key shows its ends around *** and is saved whole", async ({
  page,
}) => {
  const { panel, field } = await keyField(page);
  await expect(field).toHaveAttribute("type", "text");
  await paste(field, ` ${key}\n`);
  await expect(field).toHaveValue("tvly-d***wxyz");
  expect(await saved(page, panel)).toBe(key);
});

test("typing, deleting and replacing edit the key behind the mask", async ({
  page,
}) => {
  const { panel, field } = await keyField(page);
  await field.click();
  await page.keyboard.type("abc");
  await expect(field).toHaveValue("•••");
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("••");
  // Pasted after what was typed, then the last character taken back.
  await paste(field, "0123456789wxyz!");
  await expect(field).toHaveValue("ab0123***xyz!");
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("ab0123***wxyz");
  // All selected, a paste replaces the key.
  await field.selectText();
  await paste(field, key);
  await expect(field).toHaveValue("tvly-d***wxyz");
  // ... and a deletion clears it.
  await field.selectText();
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("");
  await paste(field, key);
  expect(await saved(page, panel)).toBe(key);
});
