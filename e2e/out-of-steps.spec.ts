import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/** Keep in step with the app's OUT_OF_STEPS; e2e can't import src. */
const OUT_OF_STEPS =
  "(Stopped at the step limit before finishing. Ask me to continue, or narrow the request.)";

/**
 * An exchange that runs out of tool steps says so in the user's language,
 * with Continue under it, sent the way the last message was.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

const sent = (page: Page) =>
  page.evaluate(() =>
    (
      (
        window as unknown as {
          __devInvokeCalls?: { cmd: string; message?: string }[];
        }
      ).__devInvokeCalls ?? []
    )
      .filter((c) => c.cmd === "ai_agent_message")
      .map((c) => c.message ?? ""),
  );

test("a reply that ran out of steps offers Continue, which asks it to go on", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "zh" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "一篇很长的稿子。");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "…" },
      { kind: "Assistant", text: OUT_OF_STEPS },
    ],
  });
  await composer(page).fill("把全文翻译成英文");
  await composer(page).press("Enter");
  const stopped = page.locator(".agent-stopped");
  await expect(stopped).toContainText("步数用完了");
  await expect(stopped).not.toContainText("Stopped at the step limit");
  await stopped.getByRole("button", { name: "继续" }).click();
  await expect.poll(async () => (await sent(page)).length).toBe(2);
  expect((await sent(page))[1]).toBe("从刚才停下的地方继续。");
  // Only the last stopped reply offers it.
  await expect(page.locator(".agent-stopped")).toHaveCount(2);
  await expect(page.locator(".agent-stopped-continue")).toHaveCount(1);
});
