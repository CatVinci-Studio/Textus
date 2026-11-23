import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { openApp, pasteMarkdown, PHONE, TABLET } from "./helpers";
import { hasPlugin, pluginsAtStart } from "./plugin-helpers";

// A chart page in the document draws at the document's zoom itself (its
// root zoomed, webview-api.js): the official mind map fits its block at
// any zoom, by its layout size, from 0.3.8 on.
const ID = "catvinci.markmap";
const fitsByLayout = () => {
  if (!hasPlugin(ID)) return false;
  const manifest = join(
    pluginsCheckout()!,
    "plugins",
    ID,
    "textus-plugin.json",
  );
  const [major, minor, patch] = JSON.parse(readFileSync(manifest, "utf8"))
    .version.split(".")
    .map(Number);
  return major > 0 || minor > 3 || (minor === 3 && patch >= 8);
};

const MAP =
  "```markmap height=300\n# Impressions\n## Pride\n### The snub\n### Proposal\n## Prejudice\n### Wickham\n## Change\n### The letter\n```\n";

const CASES = [
  { name: "a tablet", device: TABLET, zoom: 1 },
  { name: "a tablet", device: TABLET, zoom: 1.5 },
  { name: "a phone", device: PHONE, zoom: 1 },
];

for (const { name, device, zoom } of CASES)
  test.describe(`on ${name}`, () => {
    test.use(device);
    test(`a mind map fills its block's width at zoom ${zoom}, within it`, async ({
      page,
    }) => {
      test.skip(!fitsByLayout(), "no mind map 0.3.8 in the plugins checkout");
      await pluginsAtStart(page, { plugins: { [ID]: ["ai.tools"] } });
      await openApp(page, { settings: { language: "en", zoom } });
      await pasteMarkdown(page, MAP);
      // A phone's column, or a zoomed one, is narrow enough that a drawn
      // block starts folded.
      if (zoom > 1 || device === PHONE)
        await page.getByRole("button", { name: "Expand: Mind Map" }).click();
      const chart = page
        .frameLocator(".plugin-code-block-frame iframe")
        .locator("#chart");
      await expect(chart.locator("svg > g")).toBeVisible();
      // Read in one go: a redraw (the block settling) makes a new svg.
      await expect
        .poll(() =>
          chart.evaluate((el) => {
            const svg = el.querySelector("svg");
            const g = svg?.querySelector(":scope > g");
            if (!svg || !g) return false;
            const box = svg.getBoundingClientRect();
            const map = g.getBoundingClientRect();
            return (
              map.left >= box.left - 1 &&
              map.right <= box.right + 1 &&
              map.width > box.width * 0.8
            );
          }),
        )
        .toBe(true);
    });
  });
