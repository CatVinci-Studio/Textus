import { expect, test, type Page } from "@playwright/test";
import { openApp, selectionRead } from "./helpers";

/**
 * The / panel in a real browser, against its budget: in a folder of 10,000
 * notes, `[[` lists them, and each key typed after updates the rows within
 * a frame - measured in the page, from the keydown to the rows changed.
 */

const NOTES = 10_000;
const editor = '[data-active-tab="true"] .ProseMirror';

function folder(): Record<string, string> {
  const files: Record<string, string> = { "/work/vault/index.md": "Start\n" };
  const words = ["Meeting", "Research", "Draft", "会议记录", "读书笔记"];
  for (let i = 0; i < NOTES; i++)
    files[`/work/vault/area${i % 40}/${words[i % words.length]} ${i}.md`] = "";
  return files;
}

async function open(page: Page) {
  await page.addInitScript((files) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = files;
    w.__devPickFolder = "/work/vault";
  }, folder());
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-folder"),
  );
  await page.getByRole("treeitem", { name: "index.md" }).click();
  await expect(page.locator(editor)).toContainText("Start");
  await page.locator(`${editor} p`).first().click();
  await selectionRead(page);
  await page.keyboard.press("End");
}

/** Records, for each key pressed, how long until the panel's rows changed. */
function watchKeys(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __panelTimes: number[] };
    w.__panelTimes = [];
    let down = 0;
    document.addEventListener("keydown", () => (down = performance.now()), {
      capture: true,
    });
    new MutationObserver(() => {
      if (!down) return;
      w.__panelTimes.push(performance.now() - down);
      down = 0;
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
  });
}

test("[[ lists 10,000 notes, and each key filters them within a frame", async ({
  page,
}) => {
  await open(page);
  const panel = page.locator(".completion-list:not([hidden])");
  await page.keyboard.type(" [[");
  await expect(panel.locator(".completion-item").first()).toBeVisible();
  await watchKeys(page);
  for (const key of "Research 12") await page.keyboard.type(key);
  await expect(panel.locator(".completion-item").first()).toContainText(
    "Research 12",
  );
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  for (const key of "hy") await page.keyboard.type(key);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Opened again with the list known: within the keystroke too.
  await page.keyboard.type(" [[");
  await expect(panel).toBeVisible();
  const times = await page.evaluate(
    () => (window as unknown as { __panelTimes: number[] }).__panelTimes,
  );
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  console.info(
    `panel in the browser, ${NOTES} notes, ${times.length} keys: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(times.length).toBeGreaterThan(10);
  // Timed in Chromium only: CI's headless Linux WebKit runs several times
  // slower than WebKit in the app, so there the numbers are only logged.
  if (test.info().project.name === "webkit") return;
  expect(median).toBeLessThanOrEqual(8);
  expect(p95).toBeLessThanOrEqual(16);
});
