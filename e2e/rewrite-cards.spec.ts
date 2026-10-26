import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A rewrite of the whole text, every sentence changed: a card in the
 * margin for each change, beside its own passage.
 */

const BEFORE = [
  "The tide went out before dawn. Boats lay on the mud.",
  "Gulls came down to the water. They fought over scraps.",
  "At dusk the boats came back. The harbour filled with voices.",
];
const AFTER = [
  "Before dawn the tide drew back. The boats rested on the mud.",
  "Gulls dropped to the shallows. They squabbled over scraps.",
  "The boats returned at dusk. Voices filled the harbour.",
];

async function proposeRewrite(page: Page, before: string, after: string) {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, before);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Rewrite it all" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: before,
          text: after,
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      { kind: "Assistant", text: "Rewritten." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Rewrite it all");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
}

/** The cards' tops, top to bottom as the margin shows them. */
const cardTops = (page: Page) =>
  page
    .locator(".revision-note")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));

test("a rewrite of the whole text has a card for each change, beside its passage", async ({
  page,
}) => {
  await proposeRewrite(page, BEFORE.join("\n\n"), AFTER.join("\n\n"));
  await expect(page.locator(".revision-note")).toHaveCount(6);
  const tops = await cardTops(page);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  expect(tops[5] - tops[0]).toBeGreaterThan(60);
});

test("long paragraphs rewritten across have a card beside each; short ones rewritten together, one card", async ({
  page,
}) => {
  // Each sentence too unlike its new one to pair: one run of changes.
  const long = (s: string) => `${s} ${s} ${s}`;
  await proposeRewrite(
    page,
    BEFORE.map(long).join("\n\n"),
    [
      "Nothing stirred in the grey before morning.",
      "Above the water a few birds circled.",
      "Lamps came on along the quay at evening.",
    ]
      .map(long)
      .join("\n\n"),
  );
  await expect(page.locator(".revision-note")).toHaveCount(3);
  const tops = await cardTops(page);
  expect(tops[2] - tops[0]).toBeGreaterThan(60);
  await page.reload();
  // The same, short: three cards a line each read as a column of chips.
  await proposeRewrite(
    page,
    BEFORE.join("\n\n"),
    [
      "Nothing stirred in the grey before morning.",
      "Above the water a few birds circled.",
      "Lamps came on along the quay at evening.",
    ].join("\n\n"),
  );
  await expect(page.locator(".revision-note")).toHaveCount(1);
  await expect(page.locator(".revision-note")).toContainText(
    "Lamps came on along the quay at evening.",
  );
});

// A table or code block the rewrite leaves alone, quoted as the document
// writes it out: its Markdown isn't text the document has.
for (const [what, between] of [
  ["table", "| Boat | Catch |\n| :--- | :---- |\n| Mary | Cod   |"],
  ["code block", "```\nls -la\n```"],
]) {
  test(`a rewrite around a ${what} has a card for each change`, async ({
    page,
  }) => {
    // The caret in a revision's widget must not throw.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await proposeRewrite(
      page,
      ["We counted the boats.", between, "The end of the day."].join("\n\n"),
      ["We tallied the boats.", between, "Day's end."].join("\n\n"),
    );
    await expect(page.locator(".review-bar-pos")).toContainText("2");
    await expect(page.locator(".revision-note")).toHaveCount(2);
    const tops = await cardTops(page);
    expect(tops[1] - tops[0]).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });
}

test("a translation has a card for each paragraph, its paragraphs apart", async ({
  page,
}) => {
  const before = [
    "许小满承母之修伞肆，初至之客，乃一老者。",
    "曰：“漏乎？”",
    "曰：“漏声。”",
    "入夜，小满拆伞顶，于夹层得一白纽。",
  ];
  const after = [
    "Xu Xiaoman had inherited an umbrella repair shop from their mother; the first customer was an old man.",
    "“Does it leak?” “Sound.”",
    "That night, Xiaoman took apart the top of the umbrella and found a white button.",
  ];
  await proposeRewrite(page, before.join("\n\n"), after.join("\n\n"));
  const notes = page.locator(".revision-note");
  await expect(notes).toHaveCount(3);
  // The dialogue, joined, is one card, beside its own lines.
  await expect(notes.nth(1)).toContainText("“Does it leak?” “Sound.”");
  // A card's paragraphs are kept apart.
  await expect(notes.nth(1).locator(".revision-note-text")).toHaveCSS(
    "white-space",
    "pre-line",
  );
});

test("a rewrite that joins paragraphs has a card for each new paragraph, beside the ones it came from", async ({
  page,
}) => {
  // Four short paragraphs made two.
  const before = [
    "夜里，小满拆开伞顶。",
    "她在夹层里找到一枚白色纽扣。",
    "剪刀从她手里滑了下去。",
    "母亲去世三年了。",
  ];
  const after = [
    "夜里，小满拆开伞顶。她在夹层里找到一枚白色纽扣。",
    "剪刀从她手里滑了下去。母亲去世三年了。",
  ];
  await proposeRewrite(page, before.join("\n\n"), after.join("\n\n"));
  await expect(page.locator(".review-bar-pos")).toContainText("2");
  await expect(page.locator(".revision-note")).toHaveCount(2);
  const tops = await cardTops(page);
  expect(tops[1] - tops[0]).toBeGreaterThan(40);
  // Taking the first and keeping the second's originals joins those two
  // paragraphs only.
  const notes = page.locator(".revision-note");
  await notes.first().getByRole("button", { name: "Take this change" }).click();
  await notes.last().getByRole("button", { name: "Keep the original" }).click();
  const paragraphs = page.locator('[data-active-tab="true"] .ProseMirror p');
  await expect(paragraphs).toHaveText([after[0], before[2], before[3]]);
});

test("a translated heading shows its new text without the Markdown #", async ({
  page,
}) => {
  await proposeRewrite(
    page,
    "# 月亮听得见\n\n月球最后一座声音站即将关闭。",
    "# The moon can hear\n\nThe last sound station on the Moon was about to close.",
  );
  const heading = page.locator(".milkdown .ProseMirror h1");
  await expect(heading.locator(".pending-sentence-new")).toHaveText(
    "The moon can hear",
  );
});
