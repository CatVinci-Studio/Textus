import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

/** An external agent a plugin names (contributes.agents), answering Textus
 *  AI's chat through the Agent Client Protocol: the browser shim plays the
 *  agent (src/dev/agent-shim.ts), which reads the open document, asks to
 *  edit it and appends a line once allowed. */

const AGENT = "test.agent/test.agent.fake";

async function openWithAgent(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/vault/a.md": "# Notes\n\nFirst line." };
    w.__devPlugins = [
      {
        id: "test.agent",
        dir: "/plugins/test.agent",
        manifest: JSON.stringify({
          id: "test.agent",
          name: "Fake Agent",
          version: "1.0.0",
          publisher: "test",
          description: "An agent.",
          engines: { textus: "^1.3.0" },
          permissions: ["agents"],
          contributes: {
            agents: [
              {
                id: "test.agent.fake",
                name: "Fake Agent",
                command: "fake-agent",
                args: ["--acp"],
              },
            ],
          },
        }),
        dev: false,
        files: {},
      },
    ];
    w.__devPluginState = {
      allOn: true,
      plugins: { "test.agent": { enabled: true, granted: ["agents"] } },
    };
  });
  await openApp(page, {
    settings: { language: "en", chatAgent: AGENT },
    storage: { "textus-agent-panel-open": "1" },
  });
  await emit(page, "menu-open-recent", "/vault/a.md");
  await expect(page.locator(".milkdown")).toContainText("First line.");
}

async function send(page: Page, message: string) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

test("an agent reads the document, asks to edit it, and changes it in the editor once allowed", async ({
  page,
}) => {
  await openWithAgent(page);
  const panel = page.locator(".agent-panel-view");
  await expect(panel.getByRole("combobox", { name: /Mode/ })).toContainText(
    "Fake Agent",
  );
  await send(page, "Add a closing line");
  await expect(panel).toContainText("Read 3 lines.");
  const ask = panel.getByRole("group", { name: "The agent asks to go on" });
  await expect(ask).toContainText("Edit a.md");
  await ask.getByRole("button", { name: "Allow" }).click();
  await expect(ask).toBeHidden();
  await expect(panel).toContainText("Done.");
  await expect(page.locator(".milkdown")).toContainText("Added by the agent.");
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __devAgentCalls: { cmd: string }[] })
        .__devAgentCalls,
  );
  expect(calls[0]).toMatchObject({
    cmd: "agent_start",
    plugin: "test.agent",
    agent: "test.agent.fake",
    cwd: "/vault",
  });
});

test("a refused step leaves the document as it was", async ({ page }) => {
  await openWithAgent(page);
  await send(page, "Add a closing line");
  const panel = page.locator(".agent-panel-view");
  await panel.getByRole("button", { name: "Reject" }).click();
  await expect(panel).toContainText("Skipped.");
  await expect(page.locator(".milkdown")).not.toContainText(
    "Added by the agent.",
  );
});
