import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openPath, openWithPlugins } from "./plugin-helpers";
const ROOT = process.env.NOTION_OUT!;
function files(dir: string, rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(p).isDirectory()) Object.assign(out, files(p, r));
    else if (name.endsWith(".md")) out[`/work/${r}`] = readFileSync(p, "utf8");
  }
  return out;
}
const SHOTS = [
  ["Life/2026 Calendar/2026 Calendar.md", "Table"],
  ["Life/2026 Calendar/2026 Calendar.md", "Calendar"],
  ["Life/Life.md", ""],
  ["Papers/03 2026/03 2026.md", "Board"],
] as const;
for (const [doc, view] of SHOTS) {
  test(`look ${doc} ${view}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1300, height: 900 });
    await openWithPlugins(page, {
      plugins: { "catvinci.database": ["files.read", "files.write", "editor.read", "editor.write"] },
      folder: { ...files(join(ROOT, "Life"), "Life"), ...files(join(ROOT, "Papers"), "Papers") },
    });
    await openPath(page, `/work/${doc}`);
    const frame = page.frameLocator('[data-active-tab="true"] .plugin-code-block iframe').first();
    await expect(frame.locator("#views")).toBeVisible({ timeout: 30000 });
    if (view) await frame.getByRole("tab", { name: view }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/ws-${doc.replace(/[/ ]/g, "_")}-${view}.png` });
  });
}
