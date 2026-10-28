/**
 * The website's app screenshots: light, Default theme, 1440x900 at 2x on a
 * Mac, one set per site language, as PNG plus a 1920-wide WebP. Not a test.
 * Env (also shot-kit.ts's): SHOTS_OUT.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { tabFrame } from "../../plugin-helpers";
import {
  CHECKOUT,
  FONT_FACES,
  LANGS,
  LANGUAGES,
  MAC_USER_AGENT,
  PROVIDERS,
  SAMPLES,
  Sample,
  canned,
  caretAfter,
  caretAtEnd,
  emit,
  fileIn,
  launch,
  toWebp,
} from "./shot-kit";

/** What each shot needs from a language's Sample. */
const NEEDS = {
  hero: [
    "title",
    "folder",
    "library",
    "doc",
    "ask",
    "anchor",
    "edited",
    "reason",
    "commentAnchor",
    "comment",
    "reply",
  ],
  split: ["title", "folder", "doc"],
  zen: ["title", "folder", "doc", "zenFocus"],
  math: ["folder", "mathTitle", "mathDoc"],
  "math-live": ["folder", "mathTitle", "mathDoc"],
  markdown: ["folder", "tourTitle", "tourDoc", "tourCaret"],
  settings: ["title", "folder", "doc"],
  plugins: ["folder", "notes", "previewLink"],
} satisfies Record<string, (keyof Sample)[]>;
type Shot = keyof typeof NEEDS;

/** The folder the images go in. */
const OUT = process.env.SHOTS_OUT
  ? path.resolve(process.env.SHOTS_OUT)
  : path.resolve(CHECKOUT, "..", "assets", "site-assets", "app");

/** The Markdown tour's document zoom, one step out. */
const TOUR_ZOOM = 0.85;
/** Takes the shot once nothing is settling and writes it as PNG and WebP. */
async function shoot(page: Page, browser: Browser, lang: string, name: Shot) {
  // No pointer resting on anything, no stray focus ring.
  await page.mouse.move(0, 450);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const fonts = await page.evaluate(() => {
    const faces: { family: string; status: string }[] = [];
    document.fonts.forEach((face) =>
      faces.push({
        family: face.family.replace(/"/g, ""),
        status: face.status,
      }),
    );
    return faces;
  });
  expect(
    fonts.filter((face) => face.status === "error"),
    "fonts that failed to load",
  ).toEqual([]);
  if (FONT_FACES.some((face) => face.family === "SF Pro Text"))
    expect(
      fonts.some(
        (face) => face.family === "SF Pro Text" && face.status === "loaded",
      ),
      "the UI font did not load",
    ).toBe(true);
  const dir = path.join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  const png = await page.screenshot();
  writeFileSync(path.join(dir, `${name}.png`), png);
  writeFileSync(path.join(dir, `${name}.webp`), await toWebp(browser, png));
}

for (const lang of LANGS) {
  const sample = SAMPLES[lang];
  /** The language's texts for a shot, or a skip naming what is missing. */
  const textsFor = (shot: Shot): Sample => {
    const missing = NEEDS[shot].filter((field) => !sample[field]);
    test.skip(
      missing.length > 0,
      `no ${missing.join(", ")} for ${lang}: add them to SAMPLES_JSON`,
    );
    return sample as Sample;
  };

  test.describe(`website screenshots (${lang})`, () => {
    test.use({
      locale: LANGUAGES[lang].locale,
      userAgent: MAC_USER_AGENT,
    });
    const heroFile = (s: Sample) => ({
      path: fileIn(s.folder, s.title),
      content: s.doc,
    });

    test("hero", async ({ page, browser }) => {
      const s = textsFor("hero");
      await launch(page, {
        lang,
        file: heroFile(s),
        project: {
          root: `/Users/me/Documents/${s.folder}`,
          library: s.library,
        },
        storage: {
          "textus-agent-panel-open": "1",
          ...(s.panelWidth
            ? { "textus-agent-panel-width": String(s.panelWidth) }
            : {}),
        },
      });
      await canned(page, {
        ai_agent_message: [
          { kind: "User", text: s.ask },
          {
            kind: "ToolCall",
            call_id: "e1",
            name: "propose_edit",
            arguments: JSON.stringify({
              action: "replace",
              anchor: s.anchor,
              text: s.edited,
              reason: s.reason,
            }),
          },
          { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
          {
            kind: "ToolCall",
            call_id: "c1",
            name: "add_comment",
            arguments: JSON.stringify({
              anchor: s.commentAnchor,
              comment: s.comment,
            }),
          },
          { kind: "ToolResult", call_id: "c1", output: "Comment added" },
          { kind: "Assistant", text: s.reply },
        ],
      });
      const composer = page.locator(".agent-panel-view textarea");
      await composer.fill(s.ask);
      await composer.press("Enter");
      await expect(page.locator(".agent-comment")).toBeVisible();
      await expect(page.locator(".agent-proposal-reason")).toHaveText(s.reason);
      // The rewrite sentence by sentence: marked in the text, listed in
      // the card - and, with room for it, in the margin with the note.
      await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(2);
      await expect(page.locator(".agent-proposal-sentences li")).toHaveCount(2);
      // The proposal's buttons and its sentence picker on one row: a label
      // too long for it drops onto a row of its own, a band of nothing.
      const middles = await page
        .locator(".agent-proposal-actions > *")
        .evaluateAll((items) =>
          items.map((item) => {
            const box = item.getBoundingClientRect();
            return box.top + box.height / 2;
          }),
        );
      expect(
        Math.max(...middles) - Math.min(...middles),
        "the proposal's actions wrap: give this language a wider panelWidth",
      ).toBeLessThan(4);
      await composer.blur();
      await shoot(page, browser, lang, "hero");
    });

    test("split", async ({ page, browser }) => {
      const s = textsFor("split");
      await launch(page, { lang, file: heroFile(s) });
      await emit(page, "menu-toggle-split-view");
      await expect(page.locator(".split-preview h1")).toHaveText(s.title);
      await page.locator(".split-view textarea").blur();
      await shoot(page, browser, lang, "split");
    });

    test("zen", async ({ page, browser }) => {
      const s = textsFor("zen");
      await launch(page, { lang, file: heroFile(s) });
      await caretAfter(page, s.zenFocus);
      await emit(page, "menu-toggle-zen-mode");
      await expect(page.locator(".zen-current")).toHaveCount(1);
      await expect(page.locator(".zen-current")).toContainText(s.zenFocus);
      // Its fade-out is frozen with the other animations; in use it goes.
      await page.addStyleTag({ content: ".zen-hint { display: none; }" });
      await shoot(page, browser, lang, "zen");
    });

    const mathFile = (s: Sample) => ({
      path: fileIn(s.folder, s.mathTitle),
      content: s.mathDoc,
    });
    const katexLoaded = (page: Page) =>
      page.evaluate(() => document.fonts.check("16px KaTeX_Main"));

    test("math", async ({ page, browser }) => {
      const s = textsFor("math");
      await launch(page, { lang, file: mathFile(s) });
      await expect(page.locator(".milkdown .katex-display")).toHaveCount(1);
      await expect(
        page.locator(".milkdown .mermaid-preview svg"),
      ).toBeVisible();
      await caretAtEnd(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await katexLoaded(page), "KaTeX's fonts did not load").toBe(true);
      await shoot(page, browser, lang, "math");
    });

    test("math-live", async ({ page, browser }) => {
      const s = textsFor("math-live");
      await launch(page, { lang, file: mathFile(s) });
      await expect(
        page.locator(".milkdown .mermaid-preview svg"),
      ).toBeVisible();
      await page.locator(".milkdown .math-block-rendered").click();
      // At its end the preview opens under the caret, clear of the text below.
      await page.keyboard.press("End");
      await expect(page.locator(".math-float-preview")).toBeVisible();
      // ...over nothing but the page.
      const covered = await page.evaluate(() => {
        const box = document
          .querySelector(".math-float-preview")!
          .getBoundingClientRect();
        return Array.from(
          document.querySelectorAll(
            '[data-active-tab="true"] .ProseMirror > p',
          ),
        ).some((p) => {
          const range = document.createRange();
          range.selectNodeContents(p);
          return Array.from(range.getClientRects()).some(
            (r) =>
              r.left < box.right &&
              r.right > box.left &&
              r.top < box.bottom &&
              r.bottom > box.top,
          );
        });
      });
      expect(covered, "the live preview covers text").toBe(false);
      await page.evaluate(() => document.fonts.ready);
      expect(await katexLoaded(page), "KaTeX's fonts did not load").toBe(true);
      await shoot(page, browser, lang, "math-live");
    });

    test("markdown", async ({ page, browser }) => {
      const s = textsFor("markdown");
      await launch(page, {
        lang,
        file: { path: fileIn(s.folder, s.tourTitle), content: s.tourDoc },
        // View > Zoom Out, so the whole tour is on one screen.
        settings: { zoom: TOUR_ZOOM },
        // Its outline open in the sidebar, as a long document is written.
        storage: {
          "textus-sidebar-open": "1",
          "textus-sidebar-tab": "outline",
        },
      });
      const doc = page.locator('[data-active-tab="true"] .milkdown');
      await expect(doc.locator("blockquote.md-alert")).toHaveCount(1);
      await expect(doc.locator('li[data-item-type="task"]')).toHaveCount(2);
      await expect(doc.locator("hr")).toHaveCount(1);
      await expect(page.locator(".outline-row").first()).toBeVisible();
      await caretAfter(page, s.tourCaret);
      // All of it at once: the last block ends above the window's edge.
      const last = await doc
        .locator(".ProseMirror > *")
        .last()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(
        last,
        "the tour runs off the window: shorten it",
      ).toBeLessThanOrEqual(page.viewportSize()!.height - 24);
      await shoot(page, browser, lang, "markdown");
    });

    test("settings", async ({ page, browser }) => {
      const s = textsFor("settings");
      await launch(page, { lang, file: heroFile(s) });
      await caretAtEnd(page);
      await emit(page, "menu-open-settings");
      await page
        .locator(".settings-nav-item", { hasText: "Textus AI" })
        .click();
      await page.locator(".provider-picker .combobox-trigger").click();
      await expect(page.locator(".combobox-option")).toHaveCount(
        PROVIDERS.length,
      );
      await shoot(page, browser, lang, "settings");
    });

    test("plugins", async ({ page, browser }) => {
      const s = textsFor("plugins");
      const titles = Object.keys(s.notes);
      const folder = Object.fromEntries(
        titles.map((title) => [fileIn(s.folder, title), s.notes[title]]),
      );
      await launch(page, {
        lang,
        file: { path: fileIn(s.folder, titles[0]), content: "" },
        plugins: {
          plugins: {
            "catvinci.graph": ["files.read", "editor.read"],
            "catvinci.split-panes": [],
            "catvinci.quick-preview": ["editor.read", "files.read"],
          },
          folder,
        },
      });
      await canned(page, {
        resolve_vault_note: fileIn(s.folder, s.previewLink),
      });
      const editor = page.locator('[data-active-tab="true"] .ProseMirror');
      await expect(editor.locator("h1")).toContainText(titles[0]);
      // The whole folder's graph in a tab, then beside the note.
      await emit(page, "menu-plugin-command", "catvinci.graph.open");
      await expect(tabFrame(page).locator("canvas")).toBeVisible();
      await page.locator(".tab-bar [role='tab']").first().click();
      await emit(page, "menu-plugin-command", "catvinci.split-panes.right");
      await expect(page.locator(".split-divider")).toBeVisible();
      const graph = page.frameLocator(".plugin-webview-frame");
      // Read: the notes and the ones they name but don't have yet.
      await expect(graph.locator("#stats")).toHaveText(/\d/);
      // The layout settles, then fills the pane as Fit does.
      await page.waitForTimeout(5000);
      await graph.locator("#fit").click();
      await caretAtEnd(page);
      // The link's card, pinned and drawn aside, while the pointer is away.
      const link = editor.locator('[data-type="wikilink"]', {
        hasText: s.previewLink,
      });
      const card = page.locator(".hover-card");
      await expect(async () => {
        await page.mouse.move(0, 450);
        await link.last().hover();
        await expect(card).toBeVisible({ timeout: 1500 });
      }).toPass();
      await card.locator(".hover-card-button").click();
      await expect(card).toHaveClass(/hover-card-pinned/);
      // Clear of the text and of the line between the panes.
      const head = await card.locator(".hover-card-head").boundingBox();
      const box = await card.boundingBox();
      const pane = await page.locator(".split-divider").boundingBox();
      await page.mouse.move(head!.x + 40, head!.y + head!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        head!.x + 40 - Math.max(0, box!.x + box!.width - pane!.x + 48),
        head!.y + head!.height / 2 + 24,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.mouse.move(0, 450);
      await shoot(page, browser, lang, "plugins");
    });
  });
}
