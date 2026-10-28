import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * How AI text lands and leaves where the usual case isn't: Reduce motion, a
 * list, a quote, a table, Quick Ask, a right-to-left script. Each lands where
 * it will stand, nothing half written shows, and nothing is left behind.
 */

// The editor itself, not a copy fading out beside it.
const editor = '[data-active-tab="true"] .ProseMirror:not(.motion-ghost)';

async function open(page: Page, markdown: string, display = "inline") {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: display },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, markdown);
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
}

/** The proposals' parts in document order, as text. */
const layout = (page: Page) =>
  page.evaluate(
    (sel) =>
      [
        ...document.querySelectorAll(
          `${sel} :is(.pending-delete, .pending-sentence-new, .pending-insert, .pending-pick)`,
        ),
      ].map(
        (e) =>
          `${[...e.classList].filter((c) => /^pending-(delete|sentence-new|insert|pick)$/.test(c)).join(".")}|${e.textContent}`,
      ),
    editor,
  );

test("with Reduce motion a rewrite still lands a paragraph at a time, and Accept leaves no copies", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const first = "The keeper woke before dawn. He climbed the stairs slowly.";
  await open(page, `${first}\n\nA gull cried far off.`, "final");
  await streamRevise(page, [
    {
      id: "r1",
      args: {
        action: "replace",
        anchor: first,
        text: "The keeper woke early. He climbed the stairs one by one.",
      },
    },
  ]);
  await send(page);
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await expect(page.locator(`${editor} .pending-partial`)).toHaveCount(0);
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(`${editor} p`).first()).toHaveText(
    "The keeper woke early. He climbed the stairs one by one.",
  );
  await expect(page.locator(".motion-ghost")).toHaveCount(0);
});

const CASES = [
  {
    name: "a list item",
    doc: "- The keeper woke before dawn. He climbed the stairs slowly.\n- The lamp was still warm.\n\nAfter the list.",
    anchor: "The keeper woke before dawn. He climbed the stairs slowly.",
    text: "The keeper woke early. He climbed the stairs one by one.",
    after: "The lamp was still warm.",
  },
  {
    name: "a quote",
    doc: "> The keeper woke before dawn. He climbed the stairs slowly.\n\nAfter the quote.",
    anchor: "The keeper woke before dawn. He climbed the stairs slowly.",
    text: "The keeper woke early. He climbed the stairs one by one.",
    after: "After the quote.",
  },
  {
    name: "a table cell",
    doc: "| Who | What |\n| --- | --- |\n| Keeper | Climbed the stairs slowly. |\n\nAfter the table.",
    anchor: "Climbed the stairs slowly.",
    text: "Climbed the stairs one by one.",
    after: "After the table.",
  },
];

for (const c of CASES)
  test(`a rewrite inside ${c.name} streams in where it will stand`, async ({
    page,
  }) => {
    await open(page, c.doc);
    await streamRevise(page, [
      { id: "s1", args: { action: "replace", anchor: c.anchor, text: c.text } },
    ]);
    await send(page);
    await expect(page.locator(".review-bar-accept")).toBeEnabled();
    await expect(page.locator(`${editor} .pending-partial`)).toHaveCount(0);
    // Streamed or proposed whole, the same parts in the same places.
    const streamed = await layout(page);
    await page.reload();
    await open(page, c.doc);
    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: "go" },
        {
          kind: "ToolCall",
          call_id: "s1",
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: c.anchor,
            text: c.text,
          }),
        },
        { kind: "ToolResult", call_id: "s1", output: "Edit proposed" },
        { kind: "Assistant", text: "Done." },
      ],
    });
    await send(page);
    await expect(page.locator(".review-bar-accept")).toBeEnabled();
    expect(streamed).toEqual(await layout(page));
    // Taken, it reads as written, the text after it untouched.
    await page.locator(".review-bar-accept").click();
    await expect(page.locator(editor)).toContainText(c.text);
    await expect(page.locator(editor)).toContainText(c.after);
    await expect(page.locator(editor)).not.toContainText(c.anchor);
    await expect(page.locator(".motion-ghost")).toHaveCount(0, {
      timeout: 2000,
    });
  });

test("a rewrite from Quick Ask lands where its selection was", async ({
  page,
}) => {
  const text = "The keeper woke before dawn. He climbed the stairs slowly.";
  await open(page, `${text}\n\nA gull cried far off.`);
  await streamRevise(page, [
    {
      id: "q1",
      args: {
        action: "replace_selection",
        text: "The keeper woke early. He climbed the stairs one by one.",
      },
    },
  ]);
  await page.locator(`${editor} p`).first().click({ clickCount: 3 });
  await page.keyboard.press("ControlOrMeta+Shift+K");
  const composer = page.locator(".inline-chat textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await expect(
    page.locator(`${editor} .pending-sentence-new`, {
      hasText: "He climbed the stairs one by one.",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`${editor} .pending-partial`)).toHaveCount(0);
  // The document's own paragraphs (Quick Ask's reply is drawn over it).
  await expect(page.locator(`${editor} > p`).nth(1)).toHaveText(
    "A gull cried far off.",
  );
});

test("in a right-to-left script the copy fades out where the paragraph stood", async ({
  page,
}) => {
  const first =
    "استيقظ الحارس قبل الفجر بكثير، قبل أن يطلع الضوء فوق الماء. صعد الدرج ببطء، ويده على الدرابزين البارد.";
  await open(page, `${first}\n\nصاح نورس من بعيد.`);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "a1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: first,
          text: "استيقظ الحارس باكرًا. صعد الدرج.",
        }),
      },
      { kind: "ToolResult", call_id: "a1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  await send(page);
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await page.waitForTimeout(700);
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  };
  const before = await page.locator(`${editor} > p`).first().evaluate(box);
  await page.evaluate(() => {
    const w = window as unknown as { __ghost: number[] | null };
    w.__ghost = null;
    document.addEventListener(
      "click",
      () =>
        queueMicrotask(() => {
          const g = document.querySelector(".motion-ghost p");
          if (!g) return;
          const r = g.getBoundingClientRect();
          w.__ghost = [r.left, r.top, r.width, r.height];
        }),
      { once: true },
    );
  });
  await page.locator(".review-bar-accept").click();
  const ghost = await page.evaluate(
    () => (window as unknown as { __ghost: number[] | null }).__ghost,
  );
  expect(ghost).not.toBeNull();
  ghost!.forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThan(2));
  await expect(page.locator(`${editor} p`).first()).toHaveText(
    "استيقظ الحارس باكرًا. صعد الدرج.",
  );
});
