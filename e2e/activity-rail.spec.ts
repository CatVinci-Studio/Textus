import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { openWithPlugins } from "./plugin-helpers";

// With more plugin icons than the rail has room for, they scroll between
// Textus's own and Settings, neither pushed away; one dragged above the
// line is pinned among Textus's own.

const root = pluginsCheckout();

test("plugin icons scroll under the line; one dragged above it is pinned", async ({
  page,
}) => {
  test.skip(!root, "no plugins checkout");
  const dir = join(root!, "plugins");
  const plugins = Object.fromEntries(
    readdirSync(dir).map((id) => [
      id,
      JSON.parse(readFileSync(join(dir, id, "textus-plugin.json"), "utf8"))
        .permissions ?? [],
    ]),
  );
  await page.setViewportSize({ width: 900, height: 480 });
  await openWithPlugins(page, { plugins, language: "zh" });
  const scroll = page.locator(".activity-rail-scroll");
  await expect(scroll.locator(".activity-rail-item").first()).toBeVisible();
  const [height, room] = await scroll.evaluate((s) => [
    s.scrollHeight,
    s.clientHeight,
  ]);
  expect(height).toBeGreaterThan(room);
  // The end with more past it fades; scrolled to the foot, the top does.
  await expect(scroll).toHaveAttribute("data-more-down", "");
  await expect(scroll).not.toHaveAttribute("data-more-up", "");
  await scroll.evaluate((s) => s.scrollTo({ top: s.scrollHeight }));
  await expect(scroll).toHaveAttribute("data-more-up", "");
  await expect(scroll).not.toHaveAttribute("data-more-down", "");
  await scroll.evaluate((s) => s.scrollTo({ top: 0 }));
  const gear = (await page.locator(".activity-rail-settings").boundingBox())!;
  expect(gear.y + gear.height).toBeLessThanOrEqual(480);

  const first = scroll.locator(".activity-rail-item").first();
  const name = await first.getAttribute("aria-label");
  const at = (await first.boundingBox())!;
  const line = (await page.locator(".activity-rail-divider").boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2, line.y - 40, { steps: 10 });
  // One column: the line and the icons above slide aside to let it in,
  // as they do within a group.
  await expect(page.locator(".activity-rail-divider")).toHaveCSS(
    "transform",
    /matrix/,
  );
  await page.mouse.up();
  await expect(
    page
      .locator(".activity-rail-group:not(.activity-rail-scroll)")
      .getByRole("button", { name: name! }),
  ).toBeVisible();
});
