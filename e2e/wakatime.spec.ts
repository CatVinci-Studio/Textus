import { expect, test, type Page } from "@playwright/test";
import { selectionRead } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The WakaTime plugin: the user's typing in a window in front goes to
// WakaTime as heartbeats, in a batch when the window loses the front; time
// in the background sends nothing.

const ID = "catvinci.wakatime";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const KEY = "waka_12345678-1234-1234-1234-123456789abc";
type Shim = {
  __devHttpLog: { url: string; method: string; body: string | null }[];
  __devSchedule: { setAppState(s: "active" | "inactive" | "background"): void };
};

const sent = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as Shim).__devHttpLog ?? [])
      .filter((r) => r.url.endsWith("/heartbeats.bulk"))
      .flatMap(
        (r) =>
          JSON.parse(r.body ?? "[]") as {
            entity: string;
            category: string;
            project?: string;
          }[],
      ),
  );
const setState = (page: Page, state: "active" | "inactive" | "background") =>
  page.evaluate(
    (s) => (window as unknown as Shim).__devSchedule.setAppState(s),
    state,
  );

test("typing in front is sent when the window steps back; the background sends nothing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devHttp = {
      "https://api.wakatime.com/api/v1/users/current/heartbeats.bulk": {
        status: 202,
        body: "{}",
      },
    };
  });
  await openWithPlugins(page, {
    plugins: {
      [ID]: ["editor.read", "files.read", "network:api.wakatime.com"],
    },
    folder: { "/thesis/ch1.md": "# Chapter 1\n\nIt begins.\n" },
  });
  await openPath(page, "/thesis/ch1.md");
  // The key, through its command.
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type("WakaTime: Set");
  await page.keyboard.press("Enter");
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill(KEY);
  await dialog.getByRole("textbox").press("Enter");

  // The window in front, as when the user works in it.
  await setState(page, "active");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.getByText("It begins.").click();
  await selectionRead(page);
  await page.keyboard.press("End");
  await page.keyboard.type(" Then it rained.");
  await page.waitForTimeout(1500);
  await setState(page, "inactive");
  await expect.poll(async () => (await sent(page)).length).toBeGreaterThan(0);
  const beats = await sent(page);
  expect(beats.every((b) => b.entity === "/thesis/ch1.md")).toBe(true);
  expect(beats[0]).toMatchObject({
    category: "writing docs",
    project: "thesis",
  });

  // In the background, a change - an edit from elsewhere - is not work.
  const before = beats.length;
  await setState(page, "background");
  await page.keyboard.type(" More.");
  await setState(page, "inactive");
  await page.waitForTimeout(1500);
  expect((await sent(page)).length).toBe(before);
});
