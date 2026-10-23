import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// Hovering a changed sentence, or its card in the margin, darkens the
// pair's tints - as a review note's passage darkens under the pointer -
// and nothing more: no outline, and the struck original and the
// replacement both stay drawn as they were. In 1.1.0-rc.4 the hover wrote
// a class onto the decorated text, ProseMirror redrew the paragraph, and
// every strike and replacement in it replayed its entrance - the red and
// the green vanished under the pointer and faded back.

const DOC = `# Field notes

The study ran in three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents about many things.

The second paragraph stays as it is.
`;

async function proposeRevision(page: Page) {
  await pasteMarkdown(page, DOC);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Tighten it" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor:
            "The study ran in three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents about many things.",
          text: "The study covered three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents.",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
}

/** Every drawn side of every change in the text. */
const SIDES = ".milkdown .ProseMirror :is(.pending-delete, .pending-insert)";

/** Remembers the drawn sides and how they look, once their entrances are
 *  over. */
async function rememberSides(page: Page) {
  await page.waitForFunction(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).every((el) =>
        el.getAnimations().every((a: Animation) => a.playState === "finished"),
      ),
    SIDES,
  );
  await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    (window as unknown as { __sides: unknown }).__sides = els.map((el) => {
      const s = getComputedStyle(el);
      return { el, bg: s.backgroundColor, line: s.textDecorationColor };
    });
  }, SIDES);
}

/** Over a few frames under the pointer: the same elements, none replaying
 *  an entrance, none fainter than before. */
async function expectSidesUnchanged(page: Page) {
  const problems = await page.evaluate(async () => {
    const alpha = (c: string) => {
      const m = /\/ ([\d.]+)\)$/.exec(c) ?? /rgba\(.*, ([\d.]+)\)$/.exec(c);
      return m ? Number(m[1]) : 1;
    };
    const sides = (
      window as unknown as {
        __sides: { el: HTMLElement; bg: string; line: string }[];
      }
    ).__sides;
    const out: string[] = [];
    for (let frame = 0; frame < 6; frame++) {
      for (const { el, bg, line } of sides) {
        const name = `${el.className} "${el.textContent?.slice(0, 20)}"`;
        if (!el.isConnected) out.push(`redrawn: ${name}`);
        // An entrance is a CSS animation; the tint's darkening is a
        // transition.
        if (
          el
            .getAnimations()
            .some(
              (a) => a instanceof CSSAnimation && a.playState !== "finished",
            )
        )
          out.push(`entrance replayed: ${name}`);
        const s = getComputedStyle(el);
        if (s.opacity !== "1") out.push(`opacity ${s.opacity}: ${name}`);
        if (alpha(s.backgroundColor) < alpha(bg))
          out.push(`background faded: ${name}`);
        if (alpha(s.textDecorationColor) < alpha(line))
          out.push(`strike faded: ${name}`);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return Array.from(new Set(out));
  });
  expect(problems).toEqual([]);
}

/** Each drawn side of a change, or the text of its margin card, is in its
 *  darker hover tint - green for the new text, red for the original, the
 *  theme's --revision-*-hover-bg - and none is outlined. Colours are
 *  compared as values: after the transition Chromium reports the tint in
 *  oklab, the variable in srgb. */
async function expectDarker(sides: Locator) {
  await expect
    .poll(() =>
      sides.evaluateAll((els) => {
        const probe = document.createElement("span");
        document.body.append(probe);
        const srgb = (c: string) => {
          probe.style.color = `color-mix(in srgb, ${c} 100%, transparent)`;
          return (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(
            Number,
          );
        };
        const expected = {
          insert: srgb("var(--revision-insert-hover-bg)"),
          delete: srgb("var(--revision-delete-hover-bg)"),
        };
        const drawn = els
          .filter((el) => el.getClientRects().length > 0)
          .filter((el) => getComputedStyle(el).fontSize !== "0px")
          .filter((el) =>
            el.matches(".pending-insert, .pending-delete, .revision-note-text"),
          );
        const out = drawn.length === 0 ? ["no side drawn"] : [];
        for (const el of drawn) {
          const side = el.matches(".pending-delete")
            ? "delete"
            : "insert";
          const s = getComputedStyle(el);
          const got = srgb(s.backgroundColor);
          if (
            got.length !== expected[side].length ||
            got.some((v, i) => Math.abs(v - expected[side][i]) > 0.01)
          )
            out.push(`${side} background ${s.backgroundColor}`);
          if (s.boxShadow !== "none") out.push(`${side} outlined`);
        }
        probe.remove();
        return out;
      }),
    )
    .toEqual([]);
}

/** The first change's pair: both its sides (where drawn) carry the hover
 *  class and its darker tint, and no other change does. */
async function expectFirstPairHot(page: Page) {
  const pair = page.locator(
    '.milkdown [data-call="e1"][data-index="0"]:not(.pending-pick)',
  );
  const count = await pair.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++)
    await expect(pair.nth(i)).toHaveClass(/pending-sentence-hot/);
  await expect(
    page.locator('.milkdown [data-index="1"].pending-sentence-hot'),
  ).toHaveCount(0);
  await expectDarker(pair);
}

/** A margin card's text is in its darker tint, and the card is not
 *  outlined in green or red: its border is the resting one. */
async function expectCardDarker(card: Locator, border: string) {
  await expectDarker(card.locator(".revision-note-text"));
  await expect(card).toHaveCSS("border-top-color", border);
}

async function hover(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
}

/** The review bar's prev / next move its tint from sentence to sentence
 *  without redrawing anything either: in 1.1.0-rc.4 the new text's widget
 *  was keyed by the pointer, so every step redrew it and it faded in from
 *  nothing again. */
async function stepWithReviewBar(page: Page) {
  const nav = page.locator(".review-bar-nav button");
  for (const [button, index] of [
    [nav.last(), 0],
    [nav.last(), 1],
    [nav.first(), 0],
  ] as const) {
    await button.click();
    // The paragraph still flashes to be found.
    expect(
      await page
        .locator(".milkdown .ProseMirror > p", { hasText: "We spent" })
        .evaluate((p) => p.getAnimations().map((a) => a.id)),
    ).toContain("reveal-pulse");
    await expect(
      page.locator(
        `.milkdown .pending-sentence-new[data-index="${index}"].pending-sentence-focus`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `.milkdown .pending-sentence-focus:not([data-index="${index}"])`,
      ),
    ).toHaveCount(0);
    // The pair it points at is in the same darker tints as under the
    // pointer, unoutlined.
    await expectDarker(
      page.locator(
        `.milkdown [data-call="e1"][data-index="${index}"].pending-sentence-focus`,
      ),
    );
    // And so is its card, where the margin holds the other side.
    const cards = page.locator(".revision-note");
    if ((await cards.count()) > 0) {
      await expect(cards.nth(index)).toHaveClass(/revision-note-focus/);
      await expect(page.locator(".revision-note-focus")).toHaveCount(1);
      await expectDarker(cards.nth(index).locator(".revision-note-text"));
    }
    await expectSidesUnchanged(page);
  }
}

const MODES = [
  // [display, the sides drawn in the text, whether there are margin cards,
  //  whether the new text is in the text for the review bar to step through]
  ["inline", ["pending-delete", "pending-insert"], false, true],
  ["original", ["pending-delete"], true, false],
  ["final", ["pending-insert"], false, true],
] as const;

// Every view in light. In dark only the inline view: it draws both sides
// with their hover tints, which are all of this that differs by colour
// scheme.
const CASES = [
  ...MODES.map((mode) => [mode, "light"] as const),
  [MODES[0], "dark"] as const,
];

for (const [[display, sides, margin, steps], colorScheme] of CASES) {
  const stepping = steps && colorScheme === "light";
  test(`${display} (${colorScheme}): hovering a revised sentence darkens its pair and hides nothing${stepping ? ", nor do the review bar's prev / next" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: display },
      storage: { "textus-agent-panel-open": "1" },
      colorScheme,
      // The bug was an entrance replaying: keep the motion on.
      animations: true,
    });
    await proposeRevision(page);
    await expect(page.locator(".revision-note")).toHaveCount(margin ? 2 : 0);
    await page.mouse.move(5, 5);
    await rememberSides(page);
    const card = page.locator(".revision-note").first();
    const border = margin
      ? await card.evaluate((el) => getComputedStyle(el).borderTopColor)
      : "";

    for (const side of sides) {
      await hover(page, page.locator(`.milkdown .${side}`).first());
      await expectFirstPairHot(page);
      await expectSidesUnchanged(page);
      if (margin) {
        await expect(card).toHaveClass(/review-note-hot/);
        await expectCardDarker(card, border);
      }
      // Leaving takes the darker tint away, again without a redraw.
      await page.mouse.move(5, 5);
      await expect(page.locator(".milkdown .pending-sentence-hot")).toHaveCount(
        0,
      );
      await expectSidesUnchanged(page);
    }

    if (margin) {
      // The card darkens its pair in the text the same way, and itself.
      await hover(page, card);
      await expectFirstPairHot(page);
      await expectCardDarker(card, border);
      await expectSidesUnchanged(page);
      await page.mouse.move(5, 5);
    }

    if (stepping) await stepWithReviewBar(page);
  });
}

test("the ✓ / ✕ darken their pair under the pointer and still decide it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await proposeRevision(page);
  const take = page.locator(".milkdown .pending-pick-take").first();
  await take.hover();
  await expectFirstPairHot(page);
  await take.click();
  await expect(take).toHaveAttribute("aria-pressed", "true");
  // Still darker under the pointer after the redraw the decision makes.
  await expectFirstPairHot(page);
  const keep = page.locator(".milkdown .pending-pick-keep").first();
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  await expect(take).toHaveAttribute("aria-pressed", "false");
});
