import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * Proposals one reply made in a row for the same reason - a translation, a
 * paragraph at a time - are one card in the conversation (rc.6 feedback:
 * "Translate this paragraph" six cards over): the reason once, a row each
 * with its own ✓ / ✕, and Accept all / Reject all.
 */

const PARAS = [
  "The harbour woke slowly.",
  "Gulls argued over the nets.",
  "The baker opened late.",
  "Rain was due by noon.",
];

test("a run of proposals for one reason is one card, decided row by row or all at once", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, PARAS.join("\n\n"));
  const edit = (i: number, reason: string) => [
    {
      kind: "ToolCall",
      call_id: `e${i}`,
      name: "propose_edit",
      arguments: JSON.stringify({
        action: "replace",
        anchor: PARAS[i],
        text: `${PARAS[i].slice(0, -1)} (translated).`,
        reason,
      }),
    },
    { kind: "ToolResult", call_id: `e${i}`, output: "Edit proposed" },
  ];
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Translate it" },
      ...edit(0, "Translate this paragraph"),
      ...edit(1, "Translate this paragraph"),
      ...edit(2, "Translate this paragraph"),
      // Another reason: a card of its own.
      ...edit(3, "Tighten the last line"),
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Translate it");
  await composer.press("Enter");

  const group = page.locator(".agent-proposal-group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".agent-proposal")).toHaveCount(2);
  await expect(group.locator(".agent-proposal-kind")).toContainText(
    "3 changes",
  );
  // The reason once, a row each.
  await expect(group.locator(".agent-proposal-reason")).toHaveText(
    "Translate this paragraph",
  );
  const rows = group.locator(".agent-proposal-group-rows > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText(
    "Gulls argued over the nets (translated).",
  );
  await page.screenshot({
    path: "/home/chengao/.claude/jobs/2045e913/tmp/shots/proposal-group.png",
  });

  // One row's ✓ takes that paragraph alone.
  await rows.nth(1).getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".milkdown")).toContainText(
    "Gulls argued over the nets (translated).",
  );
  await expect(rows.nth(1)).toHaveAttribute("data-state", "accepted");
  await expect(page.locator(".milkdown")).toContainText(PARAS[0]);

  // Accept all takes the rest of the run, not the other card.
  await group.getByRole("button", { name: "Accept all" }).click();
  await expect(page.locator(".milkdown")).toContainText(
    "The harbour woke slowly (translated).",
  );
  await expect(page.locator(".milkdown")).toContainText(
    "The baker opened late (translated).",
  );
  await expect(page.locator(".milkdown")).toContainText(PARAS[3]);
  await expect(group.getByRole("button", { name: "Accept all" })).toHaveCount(
    0,
  );
});
