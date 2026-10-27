import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A desktop dialog's height is never in dvh (or svh, lvh): an older WebView2
// drops such declarations and the dialog grows past the window. The e2e
// Chromium can't show that, so the stylesheets are read here.

const DIALOG_STYLESHEETS = [
  "settings/SettingsPanel.css",
  "ui/app-dialog.css",
  "editor/images/ImageNameDialog.css",
  "editor/tables/InsertTableDialog.css",
  "onboarding/TutorialOverlay.css",
  "onboarding/LanguageWelcome.css",
];

describe("desktop dialogs size themselves without dvh", () => {
  it.each(DIALOG_STYLESHEETS)("%s", (file) => {
    const css = readFileSync(
      fileURLToPath(new URL(`../${file}`, import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/[\d.][dsl]vh\b/);
  });
});
