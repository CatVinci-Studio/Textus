import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * Web search (src-tauri ai/web): the Search service row in Settings, which
 * shows only where the chat model can't search by itself; the pages a
 * reply cites, listed under it; and a proposal's citations, written as
 * footnotes or left out. The AI and the key store are mocked.
 */

// English labels, as in src/i18n/locales/en.ts.
const t = {
  settingsTitle: "Settings",
  navAi: "Textus AI",
  searchServiceLabel: "Search service",
  searchServiceNone:
    "Nothing to search with yet - choose a service and add its key.",
  sendsToTavily: "Searches go to Tavily.",
  tavilyKey: "Tavily API key",
  save: "Save",
  sources: "Sources",
  footnotes: "Add sources as footnotes",
};

async function openSettings(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.getByRole("dialog", { name: t.settingsTitle });
  await panel.getByRole("button", { name: t.navAi, exact: true }).click();
  return panel;
}

/** The canned commands sent so far, with their arguments. */
async function calls(page: Page, cmd: string) {
  return page.evaluate(
    (cmd) =>
      (
        (
          window as unknown as {
            __devInvokeCalls?: { cmd: string; [k: string]: unknown }[];
          }
        ).__devInvokeCalls ?? []
      ).filter((c) => c.cmd === cmd),
    cmd,
  );
}

const results = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __devInvokeResults: Record<string, unknown> })
        .__devInvokeResults,
  );

test("the search service row shows where the model can't search, and takes a key", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", aiProvider: "deepseek" } });
  await mockInvoke(page, {
    web_search_status: { native: false, service: null },
    provider_api_key_status: false,
    set_provider_api_key: null,
  });
  const panel = await openSettings(page);
  const row = panel.locator(".settings-row", { hasText: t.searchServiceLabel });
  await expect(row).toContainText(t.searchServiceNone);

  await row.getByRole("combobox", { name: t.searchServiceLabel }).click();
  await page.getByRole("option", { name: "Tavily" }).click();
  const key = panel.getByLabel(t.tavilyKey);
  await key.fill("tvly-test");
  // Once saved, Tavily is what searches.
  await mockInvoke(page, {
    ...(await results(page)),
    web_search_status: { native: false, service: "tavily" },
  });
  await panel
    .locator(".settings-row", { hasText: t.tavilyKey })
    .getByRole("button", { name: t.save })
    .click();
  expect(await calls(page, "set_provider_api_key")).toEqual([
    {
      cmd: "set_provider_api_key",
      provider: "search-tavily",
      key: "tvly-test",
    },
  ]);
  await expect(row).toContainText(t.sendsToTavily);
});

test("no search service row where the model searches by itself", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    web_search_status: { native: true, service: null },
  });
  const panel = await openSettings(page);
  await expect(panel.getByText("Web search", { exact: true })).toBeVisible();
  await expect(panel.getByText(t.searchServiceLabel)).toHaveCount(0);
});

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

async function ask(page: Page, turns: unknown[]) {
  await openApp(page, {
    settings: { language: "en", agentDefaultMode: "write" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    ai_agent_message: turns,
    open_web_link: null,
  });
  await composer(page).fill("When are spring tides?");
  await composer(page).press("Enter");
}

const source = {
  n: 1,
  url: "https://sea.example/tides",
  title: "Tide tables",
};

test("the pages a reply cites are listed under it and open in the browser", async ({
  page,
}) => {
  await ask(page, [
    { kind: "User", text: "When are spring tides?" },
    {
      kind: "ToolCall",
      call_id: "s1",
      name: "web_search",
      arguments: JSON.stringify({ queries: ["spring tides"] }),
    },
    { kind: "ToolResult", call_id: "s1", output: "[1] Tide tables" },
    {
      kind: "Assistant",
      text: "At new and full moon [1].",
      sources: [source],
    },
  ]);
  await expect(
    page.getByText("Searching the web for “spring tides”"),
  ).toBeVisible();
  const list = page.getByRole("group", { name: t.sources });
  await expect(list).toContainText("1sea.exampleTide tables");
  await list.getByRole("button").click();
  expect(await calls(page, "open_web_link")).toEqual([
    { cmd: "open_web_link", url: source.url },
  ]);
});

function citingProposal() {
  return [
    { kind: "User", text: "Add when spring tides come" },
    {
      kind: "ToolCall",
      call_id: "p1",
      name: "propose_edit",
      arguments: JSON.stringify({
        action: "append",
        text: `Spring tides come at new and full moon [1](${source.url}).`,
      }),
    },
    { kind: "ToolResult", call_id: "p1", output: "Edit proposed" },
    { kind: "Assistant", text: "Added it [1].", sources: [source] },
  ];
}

async function documentMarkdownText(page: Page) {
  return page.evaluate(
    () =>
      document.querySelector('[data-active-tab="true"] .ProseMirror')
        ?.textContent ?? "",
  );
}

const accept = (page: Page) =>
  page.locator(".agent-proposal-actions .inline-chat-action-primary").click();

test("a proposal's sources become footnotes when the card says so", async ({
  page,
}) => {
  await ask(page, citingProposal());
  const box = page.getByRole("checkbox", { name: t.footnotes });
  await expect(box).not.toBeChecked();
  await box.check();
  await accept(page);
  const text = await documentMarkdownText(page);
  expect(text).toContain("Spring tides come at new and full moon");
  expect(text).toContain("Tide tables");
  expect(text).not.toContain("](https");
});

test("without footnotes, a proposal goes in without its citations", async ({
  page,
}) => {
  await ask(page, citingProposal());
  await expect(page.getByRole("checkbox", { name: t.footnotes })).toBeVisible();
  await accept(page);
  const text = await documentMarkdownText(page);
  expect(text).toContain("Spring tides come at new and full moon.");
  expect(text).not.toContain("[1]");
  expect(text).not.toContain("sea.example");
});
