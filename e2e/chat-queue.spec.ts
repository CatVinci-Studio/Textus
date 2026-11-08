import { expect, test, type Page } from "@playwright/test";
import {
  invokeCalls,
  mockInvoke,
  openApp,
  pasteMarkdown,
  release,
} from "./helpers";

/**
 * Messages sent while a reply is coming wait over the composer and go in
 * turn; Edit and Remove take one out; Stop gives them back to the box.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

async function open(page: Page) {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "A short note.");
  // Each reply waits for release(), so more can be sent meanwhile.
  await mockInvoke(page, {
    ai_agent_message: {
      __hold: true,
      value: [
        { kind: "User", text: "…" },
        { kind: "Assistant", text: "Done." },
      ],
    },
  });
}

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

const sent = async (page: Page) =>
  (await invokeCalls(page, "ai_agent_message")).map((c) =>
    String(c.message ?? ""),
  );

test("messages sent during a reply wait their turn and go in order", async ({
  page,
}) => {
  await open(page);
  await send(page, "First request");
  await expect(page.locator(".inline-chat-send")).toHaveText("Stop");
  await send(page, "Second request");
  await send(page, "Third request");
  const queue = page.locator(".chat-queue");
  await expect(queue.locator(".chat-queue-text")).toHaveText([
    "Second request",
    "Third request",
  ]);
  await expect(queue).toContainText("Queued (2)");
  // Each goes once the one before has finished.
  for (const n of [2, 3]) {
    await release(page, "ai_agent_message");
    await expect.poll(() => sent(page)).toHaveLength(n);
  }
  await release(page, "ai_agent_message");
  const messages = await sent(page);
  expect(messages[0]).toContain("First request");
  expect(messages[1]).toContain("Second request");
  expect(messages[2]).toContain("Third request");
  await expect(queue).toHaveCount(0);
});

test("Edit takes a queued message back into the box, Remove drops it", async ({
  page,
}) => {
  await open(page);
  await send(page, "First request");
  await send(page, "Second request");
  await send(page, "Third request");
  const queue = page.locator(".chat-queue");
  await queue.getByRole("button", { name: "Remove: Third request" }).click();
  await queue.getByRole("button", { name: "Edit: Second request" }).click();
  await expect(queue).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Second request");
  await expect.poll(() => sent(page)).toHaveLength(1);
});

test("Stop stops the reply and gives the queue back to the box", async ({
  page,
}) => {
  await open(page);
  await send(page, "First request");
  await send(page, "Second request");
  await page.locator(".inline-chat-send").click();
  await expect(page.locator(".chat-queue")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Second request");
  // The stopped reply coming late sends nothing queued: the next message
  // sent is the one typed now.
  await release(page, "ai_agent_message");
  await send(page, "Something else");
  await expect.poll(() => sent(page)).toHaveLength(2);
  expect((await sent(page))[1]).toContain("Something else");
});
