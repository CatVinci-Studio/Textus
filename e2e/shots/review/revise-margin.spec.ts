import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "../../helpers";
import { STORY, STORY_CLASSICAL, streamRevise } from "../../revise-mock";

// Screenshots of a Revise rewrite in the margin views - mid-stream and
// settled, one story (8 changes) and three (24), light and dark, in
// Chinese - for review, not a baseline. Runs only with TEXTUS_SHOTS_DIR set
// to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/revise-margin npm run screenshots:review -- revise-margin

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

async function start(
  page: Page,
  colorScheme: "light" | "dark",
  display: "new" | "original",
  stories: number,
  halfway: boolean,
) {
  const anchor = Array(stories).fill(STORY).join("\n\n");
  const text = Array(stories).fill(STORY_CLASSICAL).join("\n\n");
  const args = { action: "replace", anchor, text };
  // Held in the first story's folded dialogue.
  const json = JSON.stringify(args);
  const hold = halfway
    ? Math.ceil((json.indexOf("里面全是灰，") + 4) / 4)
    : undefined;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    colorScheme,
    settings: { language: "zh", revisionDisplay: display },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, anchor);
  await streamRevise(page, [{ id: "s1", args }], {
    chunk: 4,
    every: 20,
    hold,
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("改成文言文");
  await composer.press("Enter");
}

for (const colorScheme of ["light", "dark"] as const)
  for (const display of ["new", "original"] as const)
    for (const stories of [1, 3]) {
      const name = `${display}-${stories * 8}-${colorScheme}`;
      test(`a classical rewrite, ${name}`, async ({ page }) => {
        await start(page, colorScheme, display, stories, false);
        await expect(page.locator(".review-bar-accept")).toBeEnabled({
          timeout: 20_000,
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${DIR}/settled-${name}.png` });
      });

      if (stories === 1)
        test(`a classical rewrite mid-stream, ${name}`, async ({ page }) => {
          await start(page, colorScheme, display, stories, true);
          await page.waitForTimeout(2500);
          await page.screenshot({ path: `${DIR}/streaming-${name}.png` });
        });
    }
