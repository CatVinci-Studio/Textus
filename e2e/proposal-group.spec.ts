import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * Proposals one reply made in a row for the same reason are one card: the
 * reason once, a row each with its own ✓ / ✕, and Accept all / Reject all.
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
      // Words in between end the run; one more alone keeps its card.
      { kind: "Assistant", text: "And the last line:" },
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
  // All decided, it folds to its status line, which opens it again.
  const fold = group.locator(".agent-proposal-group-fold");
  await expect(fold).toHaveText("Applied 3");
  await expect(group.locator(".agent-proposal-group-rows")).toHaveCount(0);
  await fold.click();
  await expect(group.locator(".agent-proposal-group-rows > li")).toHaveCount(3);
});

test("many proposals in a row fold to their first rows, each with its own reason", async ({
  page,
}) => {
  const paras = Array.from({ length: 6 }, (_, i) => `Line number ${i + 1}.`);
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, paras.join("\n\n"));
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Polish it" },
      ...paras.flatMap((para, i) => [
        {
          kind: "ToolCall",
          call_id: `p${i}`,
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: para,
            text: para.replace("number", "no."),
            reason: `Reason ${i + 1}`,
          }),
        },
        { kind: "ToolResult", call_id: `p${i}`, output: "Edit proposed" },
      ]),
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Polish it");
  await composer.press("Enter");
  // Six reasons, one card.
  const group = page.locator(".agent-proposal-group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".agent-proposal")).toHaveCount(1);
  await expect(group.locator(".agent-proposal-reason")).toHaveCount(0);
  const rows = group.locator(".agent-proposal-group-rows > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(".agent-proposal-group-reason")).toHaveText(
    "Reason 1",
  );
  // The rest behind "Show 3 more"; Accept all reaches them folded or not.
  await group.getByRole("button", { name: "Show 3 more" }).click();
  await expect(rows).toHaveCount(6);
  await group.getByRole("button", { name: "Show fewer" }).click();
  await expect(rows).toHaveCount(3);
  await group.getByRole("button", { name: "Accept all" }).click();
  await expect(page.locator(".milkdown")).toContainText("Line no. 6.");
  await expect(group.locator(".agent-proposal-group-fold")).toHaveText(
    "Applied 6",
  );
});
