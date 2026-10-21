import { describe, expect, it } from "vitest";
import { guarded } from "./guard-ci-config.mjs";

describe("the CI and test configuration a fork's pull request may not change unnoticed", () => {
  it("is the workflows, the test runners' configs and what decides CI's jobs", () => {
    expect(
      guarded([
        ".github/workflows/ci.yml",
        ".github/CODEOWNERS",
        "playwright.config.ts",
        "playwright.shots.config.ts",
        "vite.config.ts",
        "eslint.config.js",
        "tsconfig.json",
        "tsconfig.node.json",
        ".nvmrc",
        "scripts/ci-changes.mjs",
        "scripts/check-versions.mjs",
      ]),
    ).toHaveLength(11);
  });

  it("is not the code, the tests themselves or the docs", () => {
    expect(
      guarded([
        "src/app/App.tsx",
        "e2e/agent-image.spec.ts",
        "src/editor/keys/format-shortcut-plugin.test.ts",
        "docs/releases/next/fix.md",
        "README.md",
        "src-tauri/src/ai/images.rs",
        "package.json",
      ]),
    ).toEqual([]);
  });
});
