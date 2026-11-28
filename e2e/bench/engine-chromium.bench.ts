import { devices, test } from "@playwright/test";
import { defineEngineBench } from "./engine-run";

// The engine benchmark in Chromium (WebView2's engine): traced, and also
// run with the CPU throttled; the page's heap held to 1 GB throughout.
// `npm run bench:engine`.
test.use({
  ...devices["Desktop Chrome"],
  browserName: "chromium",
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--js-flags=--max-old-space-size=1024"] },
});
defineEngineBench("chromium");
