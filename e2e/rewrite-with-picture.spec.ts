import { expect, test } from "@playwright/test";
import { blockIds, mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A story translated with its picture redone: merging short paragraphs
// around the picture must not take its node, or the redo finds nothing.

const editor = '[data-active-tab="true"] .ProseMirror';
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DOC =
  "林遥守着中继站。\n\n她听见敲门声。\n\n![气闸两侧的林遥](/home/me/.claude/jobs/2045e913/tmp/devprofile/data/com.catvinci.textus/assets/image-1792793243690.jpg)\n\n门外没有人。\n\n她关掉了电源。";

test("a picture redone beside a rewrite of its paragraphs stays its own, and lands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "translate" },
      {
        kind: "ToolCall",
        call_id: "g1",
        name: "generate_image",
        arguments: JSON.stringify({
          action: "replace",
          block: ids[2],
          alt: "Lin Yao on both sides of the airlock",
          prompt: "A blonde woman on both sides of an airlock window",
          image: { id: "air2", width: 1, height: 1 },
        }),
      },
      { kind: "ToolResult", call_id: "g1", output: "Image proposed" },
      {
        kind: "ToolCall",
        call_id: "t1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          block: ids[0],
          last_block: ids[4],
          text: "Lin Yao kept the relay station.\n\nShe heard a knock.\n\n![气闸两侧的林遥](assets/airlock.png)\n\nNo one was outside.\n\nShe cut the power.",
        }),
      },
      { kind: "ToolResult", call_id: "t1", output: "Edit proposed" },
      { kind: "Assistant", text: "Translated, and the picture redone." },
    ],
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/airlock-new.png" },
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("翻译成英文，图里的主角换成外国人");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();

  await page.locator(".review-bar-accept").click();
  // The old file's question, if asked, kept.
  const keep = page.getByRole("button", { name: "Keep" });
  if (await keep.isVisible().catch(() => false)) await keep.click();
  // The new picture's file isn't on this disk: it shows as not found,
  // under the name Accept saved it by.
  const picture = page.locator(`${editor} p`, { hasText: "Image not found" });
  await expect(picture).toContainText("airlock-new.png");
  await expect(
    page.locator(`${editor} p`, {
      hasText: /\S/,
      hasNotText: "Image not found",
    }),
  ).toHaveText([
    "Lin Yao kept the relay station.",
    "She heard a knock.",
    "No one was outside.",
    "She cut the power.",
  ]);
  await expect(page.locator(".agent-panel-view")).not.toContainText(
    "Couldn't find",
  );
});

const TWO =
  "林遥守着中继站。\n\n![独守中继站的她](/home/me/.claude/jobs/2045e913/tmp/devprofile/data/com.catvinci.textus/assets/image-1792793243671.jpg)\n\n她听见敲门声。\n\n![气闸两侧的林遥](/home/me/.claude/jobs/2045e913/tmp/devprofile/data/com.catvinci.textus/assets/image-1792793243690.jpg)\n\n门外没有人。";

test("two pictures redone beside one rewrite both land", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, TWO);
  const ids = await blockIds(page, TWO);
  const redo = (id: string, block: string, alt: string) => [
    {
      kind: "ToolCall",
      call_id: id,
      name: "generate_image",
      arguments: JSON.stringify({
        action: "replace",
        block,
        alt,
        prompt: alt,
        image: { id: `${id}x`, width: 1, height: 1 },
      }),
    },
    { kind: "ToolResult", call_id: id, output: "Image proposed" },
  ];
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "translate" },
      ...redo("g1", ids[1], "Her alone at the relay station"),
      ...redo("g2", ids[3], "Lin Yao on both sides of the airlock"),
      {
        kind: "ToolCall",
        call_id: "t1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          block: ids[0],
          last_block: ids[4],
          text: "Lin Yao kept the relay station.\n\n![独守中继站的她](/home/me/.claude/jobs/2045e913/tmp/devprofile/data/com.catvinci.textus/assets/image-1792793243671.jpg)\n\nShe heard a knock.\n\n![气闸两侧的林遥](/home/me/.claude/jobs/2045e913/tmp/devprofile/data/com.catvinci.textus/assets/image-1792793243690.jpg)\n\nNo one was outside.",
        }),
      },
      { kind: "ToolResult", call_id: "t1", output: "Edit proposed" },
      { kind: "Assistant", text: "Translated, both pictures redone." },
    ],
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/new.png" },
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("翻译成英文，图里的主角换成外国人");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
  await page.locator(".review-bar-accept").click();
  for (let i = 0; i < 3; i++) {
    const keep = page.getByRole("button", { name: "Keep" });
    if (await keep.isVisible().catch(() => false)) await keep.click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".review-bar")).toHaveCount(0);
  await expect(page.locator(".agent-panel-view")).not.toContainText(
    "Couldn't find",
  );
  await expect(
    page.locator(`${editor} p`, { hasText: "Image not found" }),
  ).toHaveCount(2);
  for (const old of ["image-1792793243671", "image-1792793243690"])
    await expect(page.locator(editor)).not.toContainText(old);
});
