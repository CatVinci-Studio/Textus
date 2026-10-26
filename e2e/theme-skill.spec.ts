import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockInvoke, openApp } from "./helpers";

// The theme skill's reply in the AI panel: "Use this theme" installs the
// ```css block as a user theme and switches to it.

const reply = readFileSync("src/theme/fixtures/theme-skill-reply.md", "utf8");

const injectedTheme = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => document.getElementById("textus-custom-theme")?.textContent ?? "",
  );

test("Use this theme installs the reply's theme and applies it", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const message = "/theme a calm dark page for night writing";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: message },
      { kind: "Assistant", text: reply },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");

  const chip = page.locator(".agent-theme-chip");
  await expect(chip).toContainText("Night Harbor");
  await chip.getByRole("button", { name: "Use this theme" }).click();

  await expect(chip.getByRole("button", { name: "In use" })).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
  await expect.poll(() => injectedTheme(page)).toContain("#16191d");
});
