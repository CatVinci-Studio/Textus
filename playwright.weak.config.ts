import { defineConfig, devices } from "@playwright/test";
import bench from "./playwright.bench.config";

/**
 * The benchmarks on a weak machine, simulated: no GPU, a 256 MB script heap
 * (the CPU and network are slowed per page, ops.bench.ts). A measurement,
 * not a test.
 */
export default defineConfig({
  ...bench,
  projects: [
    {
      name: "weak",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: ["--disable-gpu", "--js-flags=--max-old-space-size=256"],
        },
      },
    },
  ],
});
