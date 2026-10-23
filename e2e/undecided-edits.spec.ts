import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A request after one whose proposal is still undecided works on the
 * document as the user sees it: an edit quoted from that proposal goes
 * into it (usePendingEdits's joinEdit), instead of standing apart with
 * nowhere to go.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const written = `${editor} p`;

async function send(page: Page, message: string) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

const reply = (id: string, args: object, text: string) => [
  { kind: "User", text: "…" },
  {
    kind: "ToolCall",
    call_id: id,
    name: "propose_edit",
    arguments: JSON.stringify(args),
  },
  { kind: "ToolResult", call_id: id, output: "Edit proposed" },
  { kind: "Assistant", text },
];

test("an edit of a proposal not decided yet goes into it, and one Accept takes both", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The harbour.");
  await mockInvoke(page, {
    ai_agent_message: reply(
      "w1",
      {
        action: "append",
        text: "The tide went out before dawn.\n\nThe boats came back at dusk.",
      },
      "Two paragraphs.",
    ),
  });
  await send(page, "Write two paragraphs");
  const insert = page.locator(`${editor} .pending-insert`);
  await expect(insert).toContainText("The boats came back at dusk.");
  // Not accepted: the next request changes what it proposed.
  await mockInvoke(page, {
    ai_agent_message: reply(
      "w2",
      {
        action: "replace",
        anchor: "The boats came back at dusk.",
        text: "At dusk the boats came home, low in the water.",
      },
      "The second paragraph, warmer.",
    ),
  });
  await send(page, "Make the second paragraph warmer");
  await expect(insert).toContainText(
    "At dusk the boats came home, low in the water.",
  );
  await expect(insert).not.toContainText("The boats came back at dusk.");
  await expect(insert).toContainText("The tide went out before dawn.");
  // Still one proposal: one Accept writes both requests' text.
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(written)).toHaveText([
    "The harbour.",
    "The tide went out before dawn.",
    "At dusk the boats came home, low in the water.",
  ]);
});

test("an edit of the text a rewrite replaces goes into the rewrite", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(
    page,
    "The lighthouse stood on the rock.\n\nWaves broke below.",
  );
  await mockInvoke(page, {
    ai_agent_message: reply(
      "r1",
      {
        action: "replace",
        anchor: "The lighthouse stood on the rock.",
        text: "The old lighthouse stood alone on its rock.",
      },
      "A little lonelier.",
    ),
  });
  await send(page, "Make the first line lonelier");
  await expect(page.locator(".review-bar")).toBeVisible();
  // Not decided: the next request quotes a word of the rewrite, which has
  // no block - so no `block`.
  await mockInvoke(page, {
    ai_agent_message: reply(
      "r2",
      { action: "replace", block: null, anchor: "lighthouse", text: "beacon" },
      "A beacon instead.",
    ),
  });
  await send(page, "Call it a beacon");
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A beacon instead.",
  );
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(written)).toHaveText([
    "The old beacon stood alone on its rock.",
    "Waves broke below.",
  ]);
});

test("a new version of the passage a rewrite replaces takes the rewrite's place", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(
    page,
    "The lighthouse stood on the rock.\n\nWaves broke below.",
  );
  const passage = "The lighthouse stood on the rock.";
  await mockInvoke(page, {
    ai_agent_message: reply(
      "r1",
      {
        action: "replace",
        anchor: passage,
        text: "The old lighthouse stood alone on its rock.",
      },
      "A little lonelier.",
    ),
  });
  await send(page, "Make the first line lonelier");
  await expect(page.locator(".review-bar")).toBeVisible();
  await mockInvoke(page, {
    ai_agent_message: reply(
      "r2",
      { action: "replace", anchor: passage, text: "The beacon stood alone." },
      "Shorter, with a beacon.",
    ),
  });
  await send(page, "Shorter, and call it a beacon");
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Shorter, with a beacon.",
  );
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(written)).toHaveText([
    "The beacon stood alone.",
    "Waves broke below.",
  ]);
});
