import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Settings › Extensions (src/settings/pages/ExtensionsPage.tsx): plugins,
 * themes, skills and MCP servers, one tab each. The MCP servers are the
 * dev shim's: each one on is ready with one tool, and a command called
 * "missing" isn't installed.
 */

async function openExtensions(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.locator(".settings-nav-item", { hasText: "Extensions" }).click();
  return panel;
}

/** The servers as saved, wherever this page keeps its settings. */
const savedServers = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __devStorage?: { settings: { mcpServers?: unknown[] } };
    };
    const stored = w.__devStorage?.settings.mcpServers;
    if (stored) return stored;
    const local = JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}");
    return local.mcpServers ?? null;
  });

test("Extensions has a tab each for themes, plugins, skills and MCP", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openExtensions(page);
  await expect(panel.getByRole("tab")).toHaveText([
    "Themes",
    "Plugins",
    "Skills",
    "MCP",
  ]);
  await expect(panel.getByRole("tab", { name: "Themes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Every tab alike: a line of what it holds, Get more, "⋯", Installed.
  for (const tab of ["Themes", "Plugins", "Skills", "MCP"]) {
    await panel.getByRole("tab", { name: tab }).click();
    await expect(panel.locator(".extensions-intro")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Get more" })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "More", exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".settings-group-title").first()).toBeVisible();
  }
  await panel.getByRole("tab", { name: "Themes" }).click();
  await expect(
    panel.getByText(
      "No themes added yet. The built-in ones are picked in Editor & Appearance.",
    ),
  ).toBeVisible();
  // The gallery is in Get more; importing is behind "⋯"; the user's own
  // CSS is folded under Advanced.
  await expect(panel.locator(".theme-gallery-item")).toHaveCount(0);
  const css = panel.getByRole("textbox", { name: "Custom CSS" });
  await expect(css).toBeHidden();
  await panel.getByText("Advanced").click();
  await expect(css).toBeVisible();
  await panel.getByRole("button", { name: "More", exact: true }).click();
  await expect(panel.getByRole("menuitem")).toHaveText([
    "Import CSS…",
    "Export as CSS…",
  ]);
  // "⋯" again closes it.
  await panel.getByRole("button", { name: "More", exact: true }).click();
  await expect(panel.getByRole("menu")).toHaveCount(0);
  await panel.getByRole("button", { name: "Get more" }).click();
  await expect(panel.getByRole("tab", { name: "Themes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.locator(".theme-gallery-item")).toHaveCount(2);
});

test("built-in skills stay on; Get more lists the market's, not them", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openExtensions(page);
  await panel.getByRole("tab", { name: "Skills" }).click();
  const translate = panel.locator('[data-skill="translate"]');
  await expect(translate).toContainText("Built-in");
  await expect(translate.getByRole("checkbox")).toHaveCount(0);
  await panel.getByRole("button", { name: "Get more" }).click();
  await expect(panel.locator('[data-skill="translate"]')).toHaveCount(0);
});

test("Textus AI's Skills row opens Extensions on its Skills tab", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openExtensions(page);
  await panel.locator(".settings-nav-item", { hasText: "Textus AI" }).click();
  await panel.getByRole("button", { name: "Open", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Skills" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("an MCP server is added from the list, tried, saved, and shows its tools", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openExtensions(page);
  await panel.getByRole("tab", { name: "MCP" }).click();
  await expect(panel.getByText("No server added yet.")).toBeVisible();
  // The servers most people add are in Get more, on its MCP tab.
  await panel.getByRole("button", { name: "Get more" }).click();
  await expect(panel.getByRole("tab", { name: "MCP" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await panel
    .locator('[data-mcp-preset="context7"]')
    .getByRole("button", { name: "Add" })
    .click();
  await expect(panel.getByLabel("Command", { exact: true })).toHaveValue(
    "npx -y @upstash/context7-mcp",
  );
  await panel.getByRole("button", { name: "Try it" }).click();
  await expect(panel.locator(".mcp-tried")).toHaveText(
    "Context7 1.0: 1 tools - echo",
  );
  await panel.getByRole("button", { name: "Save" }).click();
  const card = panel.locator('[data-mcp="context7"]');
  await expect(card.locator(".mcp-state")).toHaveText("Ready · 1 tools");
  await expect(card.locator(".mcp-tool")).toHaveText(["echo"]);
  // The preset is no longer offered: it is added.
  await panel.getByRole("button", { name: "Get more" }).click();
  await expect(panel.locator('[data-mcp-preset="context7"]')).toHaveCount(0);
  await panel.locator(".plugin-back").click();
  expect(await savedServers(page)).toMatchObject([
    {
      id: "context7",
      enabled: true,
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
  ]);
  // Off: no longer running.
  await card.getByRole("checkbox", { name: "Context7" }).uncheck();
  await expect(card.locator(".mcp-state")).toHaveText("Off");
});

test("a server that can't start says why, and is removed after asking", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openExtensions(page);
  await panel.getByRole("tab", { name: "MCP" }).click();
  await panel.getByRole("button", { name: "More", exact: true }).click();
  await panel.getByRole("menuitem", { name: "Add a server…" }).click();
  await panel.getByLabel("Name").fill("Broken");
  await panel.getByLabel("Command", { exact: true }).fill("missing --flag");
  await panel.getByRole("button", { name: "Try it" }).click();
  await expect(panel.getByRole("alert")).toContainText("isn't installed");
  await panel.getByRole("button", { name: "Save" }).click();
  const card = panel.locator(".mcp-card", { hasText: "Broken" });
  await expect(card.locator(".mcp-state")).toContainText(
    "Couldn't start: `missing` isn't installed",
  );
  await card.getByRole("button", { name: "Remove" }).click();
  await page
    .getByRole("dialog", { name: /Remove the MCP server/ })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(panel.locator(".mcp-card")).toHaveCount(0);
});
