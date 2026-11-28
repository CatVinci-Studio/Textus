import { devices, test } from "@playwright/test";
import { defineEngineBench } from "./engine-run";

// The engine benchmark in WebKit, what a Mac's WKWebView runs. Playwright's
// WebKit has no CPU throttling or trace: frames and the probe only.
test.use({
  ...devices["Desktop Safari"],
  browserName: "webkit",
  viewport: { width: 1440, height: 900 },
});
defineEngineBench("webkit");
