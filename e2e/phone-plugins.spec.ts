import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { mockInvoke, PHONE } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The official plugins on a phone, where the app goes to the background
// instead of losing a window's focus.

test.use(PHONE);

const permissions = (id: string): string[] =>
  JSON.parse(
    readFileSync(
      join(pluginsCheckout()!, "plugins", id, "textus-plugin.json"),
      "utf8",
    ),
  ).permissions ?? [];

/** The page hidden or shown, as when the user leaves the app and comes back. */
const setVisible = (page: Page, visible: boolean) =>
  page.evaluate((visible) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);

const heartbeats = (page: Page) =>
  page.evaluate(
    () =>
      (
        (window as unknown as { __devHttpLog?: { url: string }[] })
          .__devHttpLog ?? []
      ).filter((r) => r.url.endsWith("/heartbeats.bulk")).length,
  );

test("WakaTime sends what it queued as soon as the app goes to the background", async ({
  page,
}) => {
  test.skip(
    !hasPlugin("catvinci.wakatime"),
    "needs the textus-plugins checkout",
  );
  const path = "/w/notes/a.md";
  await openWithPlugins(page, {
    plugins: { "catvinci.wakatime": permissions("catvinci.wakatime") },
    files: { [path]: "# Notes\n\nSome words.\n" },
  });
  await mockInvoke(page, {
    plugin_secret_get: "waka_12345678-1234-1234-1234-123456789abc",
  });
  await openPath(page, path);
  const editor = page.locator(".ProseMirror:visible");
  await editor.locator("p").tap();
  await page.keyboard.type(" More.");
  // Queued, not sent: its own timer sends every 30 seconds.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stores = (
          window as unknown as {
            __devPluginStore?: Record<string, { kv: { queue?: unknown[] } }>;
          }
        ).__devPluginStore;
        return stores?.["catvinci.wakatime|global|"]?.kv.queue?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  expect(await heartbeats(page)).toBe(0);
  await setVisible(page, false);
  await expect.poll(() => heartbeats(page), { timeout: 5000 }).toBe(1);
  await setVisible(page, true);
});
