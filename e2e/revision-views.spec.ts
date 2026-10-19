import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// The revision views (the review bar's eye menu) after the owner's flow in
// 1.1.0-rc.6: Write adds a few paragraphs, then Revise rewrites them. The
// rewrite's anchor spans paragraphs, so it used to be shown whole - one
// struck block and one green block - and no view changed anything. Now it
// is shown sentence by sentence and every view applies; Write's new text,
// which has no original, stays a green block in the margin views.

const STORY =
  "The lighthouse keeper woke before dawn. He climbed the stairs slowly. The lamp was still warm.\n\nOutside, the sea was calm. A gull cried somewhere far off.";

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

async function pickMode(page: Page, name: string) {
  await page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "Mode" })
    .click();
  await page.getByRole("option", { name }).click();
}

async function send(page: Page, message: string) {
  await composer(page).fill(message);
  await composer(page).press("Enter");
}

function proposals(id: string, args: object[]) {
  return [
    { kind: "User", text: "go" },
    ...args.flatMap((a, i) => [
      {
        kind: "ToolCall",
        call_id: `${id}${i}`,
        name: "propose_edit",
        arguments: JSON.stringify(a),
      },
      { kind: "ToolResult", call_id: `${id}${i}`, output: "Edit proposed" },
    ]),
    { kind: "Assistant", text: "Done." },
  ];
}

const VIEWS = {
  inline: "All in the text",
  original: "Original in the text, changes in the margin",
  new: "Changes in the text, original in the margin",
  final: "Result only, no markup",
} as const;

async function view(page: Page, name: keyof typeof VIEWS) {
  await page.locator(".review-bar-view-button").click();
  await page.getByRole("menuitemradio", { name: VIEWS[name] }).click();
  await expect(page.locator(".milkdown .ProseMirror")).toHaveAttribute(
    "data-revision-display",
    name,
  );
}

async function open(page: Page, animations = false) {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "levis-agent-panel-open": "1" },
    animations,
  });
}

/** Write appends the story; it waits as a green block until Accept. */
async function write(page: Page) {
  await mockInvoke(page, {
    ai_agent_message: proposals("w", [{ action: "append", text: STORY }]),
  });
  await pickMode(page, "Write");
  await send(page, "Start a story");
  await expect(page.locator(".milkdown .pending-insert")).toHaveCount(1);
}

/** Revise rewrites three sentences across both paragraphs. */
async function revise(page: Page) {
  await mockInvoke(page, {
    ai_agent_message: proposals("r", [
      {
        action: "replace",
        anchor:
          "He climbed the stairs slowly. The lamp was still warm.\n\nOutside, the sea was calm.",
        text: "He climbed the stairs. The lamp was warm.\n\nOutside, the sea lay calm.",
      },
    ]),
  });
  await pickMode(page, "Revise");
  await send(page, "Tighten it");
  await expect(page.locator(".review-bar")).toBeVisible();
}

const visible = (page: Page, selector: string) =>
  page.locator(`.milkdown ${selector}:visible`);

test("after Write's text is accepted, every view applies to Revise's rewrite across paragraphs", async ({
  page,
}) => {
  await open(page);
  await write(page);
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await expect(page.locator(".milkdown .pending-insert")).toHaveCount(0);
  await revise(page);

  // Sentence by sentence, not one struck block.
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(3);
  await expect(visible(page, ".pending-pick")).toHaveCount(3);
  await expect(page.locator(".revision-note")).toHaveCount(0);

  await view(page, "original");
  await expect(visible(page, ".pending-delete")).toHaveCount(3);
  await expect(visible(page, ".pending-insert")).toHaveCount(0);
  await expect(visible(page, ".pending-pick")).toHaveCount(0);
  await expect(page.locator(".revision-note")).toHaveCount(3);
  await expect(page.locator(".revision-note").first()).toContainText(
    "He climbed the stairs.",
  );

  await view(page, "new");
  await expect(visible(page, ".pending-delete")).toHaveCount(0);
  await expect(visible(page, ".pending-insert")).toHaveCount(3);
  await expect(page.locator(".revision-note-original")).toHaveCount(3);
  await expect(page.locator(".milkdown")).toContainText("the sea lay calm.");

  await view(page, "final");
  await expect(visible(page, ".pending-delete")).toHaveCount(0);
  await expect(visible(page, ".pending-insert")).toHaveCount(3);
  await expect(page.locator(".revision-note")).toHaveCount(0);
  expect(
    await visible(page, ".pending-insert")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");

  await view(page, "inline");
  await expect(visible(page, ".pending-delete")).toHaveCount(3);
  await expect(visible(page, ".pending-insert")).toHaveCount(3);
  await expect(visible(page, ".pending-pick")).toHaveCount(3);

  // Partly taken: the rewrite composes across the paragraphs.
  await page.locator(".milkdown .pending-pick-keep").nth(1).click();
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown p", { hasText: /\S/ })).toHaveText([
    "The lighthouse keeper woke before dawn. He climbed the stairs. The lamp was still warm.",
    "Outside, the sea lay calm. A gull cried somewhere far off.",
  ]);
});

test("Write's new text has no original: a green block in every view but the result, and the menu says so", async ({
  page,
}) => {
  await open(page);
  await write(page);
  const block = page.locator(".milkdown .pending-insert");
  const green = () =>
    block.evaluate((el) => getComputedStyle(el).backgroundColor);
  const tint = await green();
  expect(tint).not.toBe("rgba(0, 0, 0, 0)");

  for (const name of ["original", "new"] as const) {
    await view(page, name);
    await expect(block).toBeVisible();
    expect(await green()).toBe(tint);
    await expect(page.locator(".revision-note")).toHaveCount(0);
  }
  await page.locator(".review-bar-view-button").click();
  await expect(page.locator(".review-bar-menu-note")).toHaveText(
    "New text has no original: it stays in the text, in green, in these views",
  );
  await page.locator(".review-bar-view-button").click();

  await view(page, "final");
  await expect(block).toBeVisible();
  expect(await green()).toBe("rgba(0, 0, 0, 0)");
});

test("switching views cross-fades: the same elements, no entrance replayed, nothing drops to nothing", async ({
  page,
}) => {
  await open(page, true);
  await write(page);
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await revise(page);
  const parts =
    ".milkdown .ProseMirror :is(.pending-delete, .pending-insert, .pending-pick)";
  // Entrances over.
  await page.waitForFunction(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).every((el) =>
        el.getAnimations().every((a) => a.playState === "finished"),
      ),
    parts,
  );
  await page.evaluate((sel) => {
    (window as unknown as { __parts: Element[] }).__parts = Array.from(
      document.querySelectorAll(sel),
    );
  }, parts);

  for (const name of ["original", "new", "final", "inline", "new"] as const) {
    // What is shown before the switch and still after it.
    await page.evaluate((sel) => {
      const shown = (el: Element) =>
        el.getClientRects().length > 0 &&
        getComputedStyle(el).fontSize !== "0px";
      (window as unknown as { __before: Element[] }).__before = Array.from(
        document.querySelectorAll(sel),
      ).filter(shown);
    }, parts);
    await view(page, name);
    const problems = await page.evaluate(async (sel) => {
      const w = window as unknown as {
        __parts: Element[];
        __before: Element[];
      };
      const shown = (el: Element) =>
        el.getClientRects().length > 0 &&
        getComputedStyle(el).fontSize !== "0px";
      const out: string[] = [];
      const now = Array.from(document.querySelectorAll(sel));
      if (
        now.length !== w.__parts.length ||
        now.some((el, i) => el !== w.__parts[i])
      )
        out.push("redrawn");
      for (let frame = 0; frame < 8; frame++) {
        for (const el of now) {
          const name = `${el.className} "${el.textContent?.slice(0, 16)}"`;
          // A CSS animation is an entrance; the cross-fade is a script one.
          if (
            el
              .getAnimations()
              .some(
                (a) => a instanceof CSSAnimation && a.playState !== "finished",
              )
          )
            out.push(`entrance replayed: ${name}`);
          if (!shown(el)) continue;
          const opacity = Number(getComputedStyle(el).opacity);
          if (opacity === 0) out.push(`opacity 0: ${name}`);
          if (w.__before.includes(el) && opacity < 1)
            out.push(`faded though it stayed: ${name}`);
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return Array.from(new Set(out));
    }, parts);
    expect(problems, name).toEqual([]);
  }
});

test("the outlines are the theme's --revision-* colours", async ({ page }) => {
  await open(page);
  await write(page);
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await revise(page);
  // What an imported theme or custom CSS would set.
  await page.addStyleTag({
    content:
      ":root { --revision-insert-outline: rgb(1, 120, 2); --revision-delete-outline: rgb(140, 3, 4); --revision-insert-focus: rgb(5, 100, 6); --revision-delete-focus: rgb(110, 7, 8); }",
  });
  const del = page.locator('.milkdown .pending-delete[data-index="0"]');
  const ins = page.locator('.milkdown .pending-insert[data-index="0"]');
  await del.hover();
  await expect(del).toHaveCSS("box-shadow", /rgb\(140, 3, 4\)/);
  await expect(ins).toHaveCSS("box-shadow", /rgb\(1, 120, 2\)/);
  await page.mouse.move(5, 5);
  // The review bar's pointer: the focus colours.
  await page.locator(".review-bar-nav button").last().click();
  await expect(del).toHaveCSS("box-shadow", /rgb\(110, 7, 8\)/);
  await expect(ins).toHaveCSS("box-shadow", /rgb\(5, 100, 6\)/);
});
