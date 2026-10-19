import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// Hovering a changed sentence, or its card in the margin, outlines the
// pair it belongs to and nothing more: the struck original and the
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
        if (el.getAnimations().some((a) => a.playState !== "finished"))
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

/** The first change's pair: both its sides (where drawn) carry the
 *  outline, and no other change does. */
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
  // Each side drawn is outlined in its own colour: green round the new
  // text, red round the original - the theme's --revision-* outlines, not
  // the accent.
  const outlines = await pair.evaluateAll((els) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const resolve = (name: string) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const expected = {
      insert: resolve("--revision-insert-outline"),
      delete: resolve("--revision-delete-outline"),
    };
    probe.remove();
    return els
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => getComputedStyle(el).fontSize !== "0px")
      .map((el) => ({
        side: el.matches(".pending-insert, .pending-insert-mark")
          ? ("insert" as const)
          : ("delete" as const),
        shadow: getComputedStyle(el).boxShadow,
        expected,
      }));
  });
  expect(outlines.length).toBeGreaterThan(0);
  for (const { side, shadow, expected } of outlines)
    expect(shadow, side).toContain(expected[side]);
}

async function hover(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
}

const MODES = [
  // [display, the sides drawn in the text, whether there are margin cards]
  ["inline", ["pending-delete", "pending-insert"], false],
  ["original", ["pending-delete"], true],
  ["new", ["pending-insert"], true],
  ["final", ["pending-insert"], false],
] as const;

for (const colorScheme of ["light", "dark"] as const)
  for (const [display, sides, margin] of MODES)
    test(`${display} (${colorScheme}): hovering a revised sentence outlines its pair and hides nothing`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1800, height: 900 });
      await openApp(page, {
        settings: { language: "en", revisionDisplay: display },
        storage: { "levis-agent-panel-open": "1" },
        colorScheme,
        // The bug was an entrance replaying: keep the motion on.
        animations: true,
      });
      await proposeRevision(page);
      await expect(page.locator(".revision-note")).toHaveCount(margin ? 2 : 0);
      await page.mouse.move(5, 5);
      await rememberSides(page);

      for (const side of sides) {
        await hover(page, page.locator(`.milkdown .${side}`).first());
        await expectFirstPairHot(page);
        await expectSidesUnchanged(page);
        if (margin)
          await expect(page.locator(".revision-note").first()).toHaveClass(
            /review-note-hot/,
          );
        // Leaving takes the outline away, again without a redraw.
        await page.mouse.move(5, 5);
        await expect(
          page.locator(".milkdown .pending-sentence-hot"),
        ).toHaveCount(0);
        await expectSidesUnchanged(page);
      }

      if (margin) {
        // The card lights its pair in the text the same way.
        await hover(page, page.locator(".revision-note").first());
        await expectFirstPairHot(page);
        await expectSidesUnchanged(page);
        await page.mouse.move(5, 5);
      }
    });

test("the ✓ / ✕ outline their pair under the pointer and still decide it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await proposeRevision(page);
  const take = page.locator(".milkdown .pending-pick-take").first();
  await take.hover();
  await expectFirstPairHot(page);
  await take.click();
  await expect(take).toHaveAttribute("aria-pressed", "true");
  // Still outlined under the pointer after the redraw the decision makes.
  await expectFirstPairHot(page);
  const keep = page.locator(".milkdown .pending-pick-keep").first();
  await keep.click();
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  await expect(take).toHaveAttribute("aria-pressed", "false");
});

// The review bar's prev / next move its outline from sentence to sentence
// without redrawing anything either: in 1.1.0-rc.4 the new text's widget
// was keyed by the outline, so every step redrew it and it faded in from
// nothing again.
for (const display of ["inline", "new", "final"] as const)
  test(`${display}: the review bar's prev / next move the outline without redrawing the new text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: display },
      storage: { "levis-agent-panel-open": "1" },
      animations: true,
    });
    await proposeRevision(page);
    await page.mouse.move(5, 5);
    await rememberSides(page);
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
      await expectSidesUnchanged(page);
    }
  });
