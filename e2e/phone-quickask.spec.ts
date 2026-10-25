import { expect, test, type Page } from "@playwright/test";
import { PHONE, mockInvoke, openPhone, pasteMarkdown } from "./helpers";

// Quick Ask and the AI composer on an iPhone (mobile/styles/quick-ask-dock.css,
// mobile/styles/composer.css), in Chromium's phone viewport (see PHONE).
test.use(PHONE);

const PARAGRAPH = "The survey covered three districts over two months.";

/** Opens Quick Ask the only way a phone can: the keyboard toolbar's AI
 *  button, with the paragraph selected. */
async function openQuickAsk(page: Page) {
  await pasteMarkdown(page, `# Notes\n\n${PARAGRAPH}\n`);
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Ask AI" })
    .tap();
  const dock = page.locator(".quick-ask-dock");
  await expect(dock).toBeVisible();
  return dock;
}

/** Fails unless the element is at least Apple's 44pt minimum both ways. */
async function expectTouchTarget(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  expect(box.width, selector).toBeGreaterThanOrEqual(44);
  expect(box.height, selector).toBeGreaterThanOrEqual(44);
}

test("Quick Ask docks at the bottom of the screen, not in the document", async ({
  page,
}) => {
  await openPhone(page);
  const dock = await openQuickAsk(page);

  // Out of the document, across the full width, down to the bottom edge -
  // where the keyboard's top is on a real phone.
  await expect(page.locator(".milkdown .inline-chat")).toHaveCount(0);
  await expect(page.locator(".milkdown .quick-ask-widget")).toHaveCount(0);
  const box = (await dock.boundingBox())!;
  expect(box).toMatchObject({ x: 0, width: 430 });
  expect(Math.round(box.y + box.height)).toBe(932);
  expect(box.height).toBeLessThan(932 * 0.5);

  // It says what it is about, takes the toolbar's place, and has the
  // composer's focus.
  await expect(dock.locator(".quick-ask-dock-quote")).toHaveText(PARAGRAPH);
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(
    0,
  );
  await expect(dock.locator("textarea")).toBeFocused();

  // Its buttons are finger-sized.
  await expectTouchTarget(
    page,
    '.quick-ask-dock [aria-label="Continue in the full conversation"]',
  );
  await expectTouchTarget(page, '.quick-ask-dock [aria-label="Close chat"]');
  await expectTouchTarget(page, ".quick-ask-dock .inline-chat-chip-remove");
  await expectTouchTarget(page, ".quick-ask-dock .inline-chat-send");

  // Dropping the selection leaves it "at the cursor".
  await dock.locator(".inline-chat-chip-remove").tap();
  await expect(dock.locator(".quick-ask-dock-quote")).toHaveText(
    "At the cursor",
  );

  // Escape still closes it.
  await page.keyboard.press("Escape");
  await expect(dock).toHaveCount(0);
});

test("the mode picker is a segmented control on a phone", async ({ page }) => {
  await openPhone(page);
  const dock = await openQuickAsk(page);
  const modes = dock.getByRole("radiogroup", { name: "Mode" });
  // Quick Ask: Write (on) and Review.
  await expect(modes.getByRole("radio")).toHaveText(["Write", "Review"]);
  await expect(modes.getByRole("radio", { name: "Write" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await modes.getByRole("radio", { name: "Review" }).tap();
  await expect(modes.getByRole("radio", { name: "Review" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(modes.getByRole("radio", { name: "Write" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(dock.locator("select")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The Textus AI sheet's composer: the two and Create, and 44pt buttons.
  await page.locator(".window-bar-toggle").tap();
  const sheet = page.locator(".agent-panel");
  await expect(
    sheet.getByRole("radiogroup", { name: "Mode" }).getByRole("radio"),
  ).toHaveText(["Write", "Review", "Create"]);
  await expectTouchTarget(page, ".agent-panel .chat-mode-segments");
  await expectTouchTarget(page, ".agent-panel .inline-chat-attach");
  await expectTouchTarget(page, ".agent-panel .inline-chat-web-search");
});

test("a proposed edit is reviewed in the dock and lands in the document", async ({
  page,
}) => {
  await openPhone(page);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "shorter" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: PARAGRAPH,
          text: "The survey covered three districts.",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      { kind: "Assistant", text: "Shortened." },
    ],
  });
  const dock = await openQuickAsk(page);
  await dock.locator("textarea").fill("shorter");
  await dock.locator(".inline-chat-send").tap();

  // The preview is in the document; the decision is in the dock.
  await expect(
    page.locator(".milkdown .pending-delete").first(),
  ).toBeAttached();
  await expect(dock).toContainText("Shortened.");
  const accept = dock.getByRole("button", { name: "Accept", exact: true });
  await expect(accept).toBeVisible();
  expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The reply area sits above the input, the context row above both.
  const status = (await dock.locator(".quick-ask-status").boundingBox())!;
  const head = (await dock.locator(".quick-ask-dock-head").boundingBox())!;
  const input = (await dock.locator("textarea").boundingBox())!;
  expect(head.y).toBeLessThan(status.y);
  expect(status.y).toBeLessThan(input.y);

  await accept.tap();
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The survey covered three districts.",
  );
});

test("a / skill suggestion is picked with a tap", async ({ page }) => {
  await openPhone(page);
  await mockInvoke(page, {
    load_agent_workspace: {
      skills: [
        { name: "polish", description: "Tighten the prose", prompt: "Polish" },
      ],
    },
  });
  const dock = await openQuickAsk(page);
  const input = dock.locator("textarea");
  await input.fill("/po");
  // The user's skill by its name first; the built-in Social post (alias
  // "post") matches too, after it.
  const row = dock.locator(".inline-chat-skill-item").first();
  await expect(row).toContainText("/polish");
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await row.tap();
  await expect(input).toHaveValue("/polish ");
  // Picked once, and the keyboard's field kept its focus.
  await expect(input).toBeFocused();
});

test("continue in panel hands the exchange to the AI sheet", async ({
  page,
}) => {
  await openPhone(page);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "what is this about?" },
      { kind: "Assistant", text: "Fieldwork scope." },
    ],
  });
  const dock = await openQuickAsk(page);
  await dock.getByRole("radio", { name: "Review" }).tap();
  await dock.locator("textarea").fill("what is this about?");
  await dock.locator(".inline-chat-send").tap();
  await expect(dock).toContainText("Fieldwork scope.");
  await dock
    .getByRole("button", { name: "Continue in the full conversation" })
    .tap();
  await expect(page.locator(".quick-ask-dock")).toHaveCount(0);
  await expect(page.locator(".agent-panel")).toContainText("Fieldwork scope.");
  // The page's footprint is gone with it.
  await expect(page.locator("html")).not.toHaveClass(/has-quick-ask-dock/);
});
