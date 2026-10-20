import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// Learning from revision choices (ai/revision/revision-learning.ts): the
// same kind of change turned down again and again - here 「」 made “” -
// leads to one quiet suggestion where the review bar was, and Remember
// saves it as a memory the Memory tab lists. The note is the writer's own.

const NOTE =
  "会议记录：经理说「下周再议」。小李回答「没问题」。\n\n第二天，大家都说「辛苦了」。";
const RULE = "Keep 「」; don't change it to “”.";

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

function proposal(id: string, anchor: string, text: string) {
  return [
    { kind: "User", text: "polish" },
    {
      kind: "ToolCall",
      call_id: id,
      name: "propose_edit",
      arguments: JSON.stringify({ action: "replace", anchor, text }),
    },
    { kind: "ToolResult", call_id: id, output: "Edit proposed" },
    { kind: "Assistant", text: "Polished." },
  ];
}

const workspace = (items: unknown[]) => ({
  instructions: [],
  project_instructions: "",
  skills: [],
  root: null,
  style: null,
  library: [],
  memories: { items, chars: 0, cap: 4000 },
  remember: false,
  levis_project: false,
});

/** The calls a canned command answered (window.__devInvokeCalls). */
async function calls(page: Page, cmd: string) {
  return page.evaluate(
    (name) =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === name),
    cmd,
  );
}

async function proposeAndReject(
  page: Page,
  id: string,
  anchor: string,
  text: string,
  changes: number,
) {
  await mockInvoke(page, {
    load_agent_workspace: workspace([]),
    ai_agent_message: proposal(id, anchor, text),
    memory_remember: { remembered: "personal/memory/Keep", scope: "personal" },
  });
  await composer(page).fill("Polish this");
  await composer(page).press("Enter");
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(
    changes,
  );
  await page
    .locator(".review-bar:not(.learn-bar)")
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(0);
}

test("rejecting 「」 made “” three times offers to remember it, and Remember saves a memory the Memory tab lists", async ({
  page,
}) => {
  // Remember automatically off: the suggestion still comes, and only the
  // click saves.
  await openApp(page, {
    settings: { language: "en", rememberAutomatically: false },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, NOTE);

  await proposeAndReject(
    page,
    "p1",
    "会议记录：经理说「下周再议」。小李回答「没问题」。",
    "会议记录：经理说“下周再议”。小李回答“没问题”。",
    2,
  );
  // Two rejections, one proposal: not yet.
  const learn = page.locator(".learn-bar");
  await expect(learn).toHaveCount(0);

  await proposeAndReject(
    page,
    "p2",
    "第二天，大家都说「辛苦了」。",
    "第二天，大家都说“辛苦了”。",
    1,
  );
  await expect(learn).toContainText(
    `You turned down changing 「」 to “” several times. Remember this? ${RULE}`,
  );
  expect(await calls(page, "memory_remember")).toEqual([]);

  await learn.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(learn).toHaveText(
    "Remembered. See or delete it in the Memory tab.",
  );
  expect(await calls(page, "memory_remember")).toEqual([
    expect.objectContaining({
      kind: "requirement",
      scope: "personal",
      text: RULE,
    }),
  ]);

  // The memory is an ordinary one: listed in the Memory tab (which reads
  // it back from the backend).
  await mockInvoke(page, {
    load_agent_workspace: workspace([
      {
        id: "personal/memory/Keep",
        scope: "personal",
        kind: "requirement",
        text: RULE,
        file: "/config/agent/memory/Keep.md",
        remembered: {
          created: "2026-10-19T09:30:00Z",
          updated: "2026-10-19T09:30:00Z",
          conversation: null,
          title: null,
          document: null,
        },
        included: true,
      },
    ]),
  });
  await page.locator("#agent-tab-memory").click();
  await expect(page.locator(".memory-remembered")).toContainText(RULE);

  // Answered: the same kind is never offered again.
  const log = await page.evaluate(
    () =>
      (
        window as unknown as {
          __devStorage: {
            revisionChoices: { answers: Record<string, { answer: string }> };
          };
        }
      ).__devStorage.revisionChoices,
  );
  expect(log.answers["swap\t「」\t“”"].answer).toBe("remembered");
});

test("a rewrite superseded by a new request teaches nothing", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, NOTE);
  for (const id of ["s1", "s2", "s3"]) {
    await mockInvoke(page, {
      load_agent_workspace: workspace([]),
      ai_agent_message: proposal(
        id,
        "第二天，大家都说「辛苦了」。",
        "第二天，大家都说“辛苦了”。",
      ),
    });
    await composer(page).fill("Polish this");
    await composer(page).press("Enter");
    await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(1);
  }
  const log = await page.evaluate(
    () =>
      (window as unknown as { __devStorage: { revisionChoices: unknown } })
        .__devStorage.revisionChoices,
  );
  expect(log).toBeNull();
});
