/**
 * The README's pictures: one large window of the Markdown tour, then small
 * cards, each cut around the thing it shows with an even margin. Light,
 * Default theme, at 2x, in each README language's UI. Not a test.
 * Env: LANGS (as shot-kit.ts), TEXTUS_PLUGINS_DIR for the plugin cards.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { pluginsCheckout } from "../../../vite.dev-plugins";
import { tabFrame } from "../../plugin-helpers";
import { around, CARD, film, framed } from "./card-frame";
import {
  canned,
  LANGS,
  LANGUAGES,
  MAC_USER_AGENT,
  SAMPLES,
  caretAfter,
  fileIn,
  launch,
  type Sample,
} from "../website/shot-kit";

/** Site language code -> the README's folder under docs/images/readme. */
const README_DIR: Record<string, string> = {
  en: "en",
  zh: "zh",
  "zh-hant": "zh-Hant",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  ru: "ru",
  pt: "pt",
};

/** The README's own texts, beside shot-kit's samples. */
interface Extra {
  /** A small table, as Markdown, where the sample's document has none. */
  table?: string;
  /** A left-to-right flowchart's nodes, as Mermaid writes them. */
  flow: string;
  /** What inline completion offers after the sample's note. */
  continuation: string;
  /** A sentence with one slip the grammar check marks: the wrong words,
   *  the right ones, and why. */
  slip: { sentence: string; wrong: string; right: string; issue: string };
}

const EXTRA: Record<string, Extra> = {
  en: {
    table: `| Act | Scenes | Lines |
|---|---:|---:|
| I | 5 | 846 |
| II | 2 | 640 |
| III | 4 | 920 |`,
    flow: `A[Read the scene] --> B{Anything unclear?}
  B -- Yes --> C[Look up the notes]
  B -- No --> D[Write it down]
  C --> D`,
    continuation: " His delay is less doubt than dread.",
    slip: {
      sentence: "Hamlet and Horatio was watching the ghost from the wall.",
      wrong: "was",
      right: "were",
      issue: "“Hamlet and Horatio” takes “were”.",
    },
  },
  zh: {
    flow: `A[读原文] --> B{有没有疑问}
  B -- 有 --> C[查脂批]
  B -- 没有 --> D[写笔记]
  C --> D`,
    continuation: "后文的“贾雨村”谐音“假语存”，与它正好成对。",
    slip: {
      sentence: "曹雪芹把这层意思写的很含蓄，读者往往一眼看不出来。",
      wrong: "的",
      right: "得",
      issue: "补语前应用“得”。",
    },
  },
  "zh-hant": {
    flow: `A[讀原文] --> B{有沒有疑問}
  B -- 有 --> C[查注釋]
  B -- 沒有 --> D[寫筆記]
  C --> D`,
    continuation: "石猴出世時「目運兩道金光」，也早已預示他的不凡。",
    slip: {
      sentence: "孫悟空把天宮鬧的天翻地覆。",
      wrong: "的",
      right: "得",
      issue: "補語前應用「得」。",
    },
  },
  ja: {
    flow: `A[本文を読む] --> B{わからない所は?}
  B -- ある --> C[注釈を調べる]
  B -- ない --> D[メモを書く]
  C --> D`,
    continuation: "この距離があるからこそ、のちの風刺が生きてくる。",
    slip: {
      sentence: "猫の目からは、人間の滑稽さがよく見れる。",
      wrong: "見れる",
      right: "見られる",
      issue: "「見る」の可能形は「見られる」です。",
    },
  },
  ko: {
    flow: `A[원문 읽기] --> B{모르는 곳이 있나?}
  B -- 있다 --> C[주석 찾기]
  B -- 없다 --> D[메모 쓰기]
  C --> D`,
    continuation: " 그래서 달밤의 풍경은 곧 그리움의 풍경이 된다.",
    slip: {
      sentence: "허 생원은 그날 밤 이야기를 몇 번이고 되풀이 했다.",
      wrong: "되풀이 했다",
      right: "되풀이했다",
      issue: "‘되풀이하다’는 한 단어이므로 붙여 씁니다.",
    },
  },
  es: {
    flow: `A[Leer el capítulo] --> B{¿Algo confuso?}
  B -- Sí --> C[Buscar las notas]
  B -- No --> D[Tomar notas]
  C --> D`,
    continuation:
      " Serán sus lecturas, y no sus actos, las que lo pongan en camino.",
    slip: {
      sentence: "Los libros de caballerías le secó el cerebro.",
      wrong: "secó",
      right: "secaron",
      issue: "El sujeto es plural: «los libros» pide «secaron».",
    },
  },
  fr: {
    flow: `A[Lire le chapitre] --> B{Un passage obscur ?}
  B -- Oui --> C[Chercher les notes]
  B -- Non --> D[Prendre des notes]
  C --> D`,
    continuation: " Valjean n’entrera qu’ensuite, chez cet homme-là.",
    slip: {
      sentence: "Les rumeurs sur l’évêque était nombreuses.",
      wrong: "était",
      right: "étaient",
      issue: "Le sujet « les rumeurs » est au pluriel.",
    },
  },
  de: {
    flow: `A[Den Text lesen] --> B{Etwas unklar?}
  B -- Ja --> C[Anmerkungen nachschlagen]
  B -- Nein --> D[Notizen schreiben]
  C --> D`,
    continuation:
      " Gregor sorgt sich zuerst um den Zug, nicht um seinen Körper.",
    slip: {
      sentence: "Gregor und seine Schwester spricht kaum miteinander.",
      wrong: "spricht",
      right: "sprechen",
      issue: "Zwei Subjekte verlangen den Plural: „sprechen“.",
    },
  },
  ru: {
    flow: `A[Прочитать главу] --> B{Что-то неясно?}
  B -- Да --> C[Найти комментарий]
  B -- Нет --> D[Записать заметку]
  C --> D`,
    continuation: " Поэтому дом Облонских и становится первой сценой романа.",
    slip: {
      sentence: "Все счастливые семьи похож друг на друга.",
      wrong: "похож",
      right: "похожи",
      issue: "Подлежащее во множественном числе: «похожи».",
    },
  },
  pt: {
    flow: `A[Ler o capítulo] --> B{Algo obscuro?}
  B -- Sim --> C[Consultar as notas]
  B -- Não --> D[Tomar notas]
  C --> D`,
    continuation: " Desconfiar do narrador passa a ser parte da leitura.",
    slip: {
      sentence: "Os vizinhos de Bentinho o chamava de Dom Casmurro.",
      wrong: "chamava",
      right: "chamavam",
      issue: "O sujeito «os vizinhos» pede o plural: «chamavam».",
    },
  },
};

test.use({
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  userAgent: MAC_USER_AGENT,
});

/** This Mac's own monospace font for code, as the app's WebKit draws it;
 *  Chromium here draws a JetBrains Mono build without glyphs. */
const CODE_FONT = `
  :root { --font-mono: "SF Mono", Menlo, "PingFang SC", "Hiragino Sans", monospace !important; }
  .ProseMirror pre, .ProseMirror code, .cm-editor, .cm-content, kbd {
    font-family: "SF Mono", Menlo, "PingFang SC", "Hiragino Sans", monospace !important;
  }
`;

/** Cuts the area around `targets` and frames it as the website does: a
 *  rounded window with a soft shadow on its paper, `aspect` (width /
 *  height) wide, the window as large as the frame lets it be. */
async function card(
  page: Page,
  lang: string,
  name: string,
  targets: Locator[],
  {
    margin = 20,
    aspect = CARD,
    frame = 640,
    inset = 18,
  }: { margin?: number; aspect?: number; frame?: number; inset?: number } = {},
) {
  await scrollIn(targets[0]);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = await page.screenshot({
    clip: await around(page, targets, margin, name),
  });
  writeFileSync(
    cardFile(lang, name),
    await framed(page, png, { aspect, width: frame, inset }),
  );
}

/** A block past the window's edge would be cut: brought to its middle. */
function scrollIn(target: Locator) {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    if (box.top < -2 || box.bottom > window.innerHeight + 2)
      el.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

/** Where a card of `lang` goes. */
function cardFile(lang: string, name: string, ext = "webp") {
  const dir = path.join("docs/images/readme", README_DIR[lang]);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.${ext}`);
}

/** A card's film: `act` played in the area `targets` take up. */
async function filmCard(
  page: Page,
  lang: string,
  name: string,
  targets: (after: boolean) => Locator[],
  act: () => Promise<void>,
  { margin = 20, inset = 18 }: { margin?: number; inset?: number } = {},
) {
  await page.evaluate(() => document.fonts.ready);
  await scrollIn(targets(false)[0]);
  await film(
    page,
    cardFile(lang, name),
    targets,
    act,
    {
      aspect: CARD,
      width: 640,
      inset,
    },
    margin,
  );
}

/** Leaves only the document's blocks that hold `targets` in sight: the
 *  rest, the window's bars and the caret go, so a card's margin is page.
 *  By position: the app rewrites its elements' classes. */
async function isolate(targets: Locator[]): Promise<() => Promise<void>> {
  const kept = await Promise.all(
    targets.map((target) =>
      target.evaluate((el) => {
        const root = el.closest(".ProseMirror")!;
        let block: Element = el;
        while (block.parentElement !== root) block = block.parentElement!;
        return Array.from(root.children).indexOf(block) + 1;
      }),
    ),
  );
  const keep = [...new Set(kept)].map((n) => `:not(:nth-child(${n}))`).join("");
  const style = await targets[0].page().addStyleTag({
    content: `
      [data-active-tab="true"] .ProseMirror > *${keep},
      .window-bar, .tab-bar, .shots-traffic-lights,
      [class*="review-bar"], [class*="notes-bar"] { visibility: hidden !important; }
      .ProseMirror { caret-color: transparent !important; }
    `,
  });
  return () => style.evaluate((el) => (el as Element).remove());
}

/** The app opened as shot-kit's launch does, with this Mac's code font. */
async function start(page: Page, options: Parameters<typeof launch>[1]) {
  // The note that offers Backlinks for a document with [[links]] is seen.
  await launch(page, {
    ...options,
    // Large words in a small card; the tour's window keeps its own.
    settings: { zoom: 1.35, ...options.settings },
    storage: {
      "textus-plugins-offered-for": JSON.stringify(["wikilinks"]),
      ...options.storage,
    },
  });
  await page.addStyleTag({ content: CODE_FONT });
}

/** A word of an official plugin's manifest in a UI language: its `l10n`. */
function pluginWord(id: string, key: string, ui: string): string {
  const root = pluginsCheckout();
  if (!root)
    throw new Error("no textus-plugins checkout: set TEXTUS_PLUGINS_DIR");
  const manifest = JSON.parse(
    readFileSync(path.join(root, "plugins", id, "textus-plugin.json"), "utf8"),
  ) as { l10n: Record<string, Record<string, string>> };
  return manifest.l10n[ui]?.[key] ?? manifest.l10n.en[key];
}

const emitTo = (page: Page, name: string, payload?: unknown) =>
  page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );

const doc = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

for (const lang of LANGS) {
  const sample = SAMPLES[lang] as Sample;
  const extra = EXTRA[lang];

  test.describe(`README pictures (${lang})`, () => {
    test.use({ locale: LANGUAGES[lang].locale });

    /** A narrow window for the writing cards: a short line, large words. */
    async function open(
      page: Page,
      title: string,
      content: string,
      height = 820,
    ) {
      await page.setViewportSize({ width: 680, height });
      await start(page, {
        lang,
        file: { path: fileIn(sample.folder, title), content },
      });
    }

    test("writing", async ({ page }) => {
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.tourTitle),
          content: sample.tourDoc,
        },
        settings: { zoom: 1 },
      });
      await expect(doc(page).locator("blockquote.md-alert")).toHaveCount(1);
      await caretAfter(page, sample.tourCaret);
      await card(page, lang, "markdown", [page.locator(".app-shell")], {
        margin: 0,
        frame: 1200,
        aspect: 16 / 10,
        inset: 0,
      });
    });

    test("code", async ({ page }) => {
      // The tour's code block, on a page of its own: at the tour's end it
      // sits too low to be centred.
      const code = /```[\s\S]*?\n```/.exec(sample.tourDoc)![0];
      await open(page, sample.tourTitle, `# ${sample.tourTitle}\n\n${code}\n`);
      const block = doc(page).locator("pre").first();
      await expect(block).toBeVisible();
      await isolate([block]);
      await card(page, lang, "code", [block]);
    });

    test("table", async ({ page }) => {
      // The sample's own table; English's sample has none.
      const table =
        /^\|.*\|\n\|[-:| ]+\|\n(?:\|.*\|\n?)+/m.exec(sample.doc)?.[0] ??
        extra?.table;
      test.skip(!table, `no table for ${lang}`);
      await open(page, sample.tourTitle, `# ${sample.tourTitle}\n\n${table}\n`);
      const shown = doc(page).locator("table").first();
      await expect(shown).toBeVisible();
      await isolate([shown]);
      await card(page, lang, "table", [shown]);
    });

    /** A narrow window: the note's lines wrap short, its words stay large
     *  in a small card. */
    const NARROW = { width: 520, height: 820 };

    async function openNote(page: Page, panel = false) {
      if (!panel) await page.setViewportSize(NARROW);
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: sample.doc,
        },
        project: {
          root: `/Users/me/Documents/${sample.folder}`,
          library: sample.library,
        },
        // Larger words for a small card.
        settings: { enableCompletion: true },
        storage: panel ? { "textus-agent-panel-open": "1" } : {},
      });
    }

    /** The note's paragraph the edit rewrites. */
    const note = (page: Page) =>
      doc(page).locator(":scope > p", { hasText: sample.anchor.slice(0, 8) });

    test("ai: edits and a comment", async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 820 });
      await openNote(page, true);
      await canned(page, {
        ai_agent_message: [
          { kind: "User", text: sample.ask },
          {
            kind: "ToolCall",
            call_id: "e1",
            name: "propose_edit",
            arguments: JSON.stringify({
              action: "replace",
              anchor: sample.anchor,
              text: sample.edited,
              reason: sample.reason,
            }),
          },
          { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
          {
            kind: "ToolCall",
            call_id: "c1",
            name: "add_comment",
            arguments: JSON.stringify({
              anchor: sample.commentAnchor,
              comment: sample.comment,
            }),
          },
          { kind: "ToolResult", call_id: "c1", output: "Comment added" },
          { kind: "Assistant", text: sample.reply },
        ],
      });
      const composer = page.locator(".agent-panel-view textarea");
      const comment = page.locator(".agent-comment").first();
      const paragraph = note(page);
      const rewritten = doc(page).locator(":scope > p", {
        has: page.locator(".pending-sentence"),
      });
      // The paragraph as the request goes and the edits come in.
      const restore = await isolate([paragraph]);
      await filmCard(
        page,
        lang,
        "ai-revise",
        (after) => [after ? rewritten : paragraph],
        async () => {
          await composer.fill(sample.ask);
          await composer.press("Enter");
          await expect(comment).toBeVisible();
          await expect(
            doc(page).locator(".pending-sentence").first(),
          ).toBeVisible();
          await page.waitForTimeout(1200);
        },
      );
      await restore();
      await composer.blur();
      await card(page, lang, "ai-review", [comment], {
        margin: 4,
      });
    });

    test("ai: continuation", async ({ page }) => {
      test.skip(!extra, `no README texts for ${lang}`);
      await openNote(page);
      await canned(page, { ai_complete: extra.continuation });
      const paragraph = note(page);
      const text = (await paragraph.innerText()).trim();
      await caretAfter(page, text.slice(-8), true);
      await isolate([paragraph]);
      // Mid-document, a continuation comes on request; Tab takes it.
      await filmCard(
        page,
        lang,
        "ai-continue",
        () => [paragraph],
        async () => {
          await page.keyboard.press("ControlOrMeta+Shift+Space");
          await expect(page.locator(".ghost-text")).toHaveAttribute(
            "data-suggestion",
            extra.continuation,
          );
          await page.waitForTimeout(1400);
          await page.keyboard.press("Tab");
          await expect(page.locator(".ghost-text")).toHaveCount(0);
          await page.waitForTimeout(300);
        },
      );
    });

    test("ai: grammar", async ({ page }) => {
      test.skip(!extra, `no README texts for ${lang}`);
      const { sentence, wrong, right, issue } = extra.slip;
      const at = Array.from(sentence.slice(0, sentence.indexOf(wrong))).length;
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: `# ${sample.title}\n\n`,
        },
        settings: { enableGrammarCheck: true },
      });
      await canned(page, {
        ai_grammar_check: [
          {
            start: at,
            end: at + Array.from(wrong).length,
            issue,
            suggestion: right,
            original: wrong,
          },
        ],
      });
      await page.setViewportSize(NARROW);
      await doc(page).locator(":scope > *").last().click();
      // The document's end: End on a Mac scrolls.
      await page.keyboard.press("ControlOrMeta+ArrowDown");
      await page.keyboard.press("Enter");
      // The new paragraph, by position: hovering redraws the underline.
      const index = (await doc(page).locator(":scope > *").count()) - 1;
      const paragraph = doc(page).locator(":scope > *").nth(index);
      const underline = doc(page).locator(".grammar-issue");
      const popover = page.locator(".grammar-popover");
      await isolate([paragraph]);
      await filmCard(
        page,
        lang,
        "ai-grammar",
        (after) => (after ? [paragraph, popover] : [paragraph]),
        async () => {
          await page.keyboard.type(sentence, { delay: 45 });
          await expect(underline).toHaveText(wrong);
          await page.waitForTimeout(500);
          await underline.hover();
          await expect(popover).toBeVisible();
          await page.waitForTimeout(400);
        },
      );
    });

    test("ai: skills", async ({ page }) => {
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: sample.doc,
        },
      });
      // Create, in Settings › Extensions: its / menu holds what it makes.
      await page.evaluate(() =>
        window.dispatchEvent(new Event("textus-open-create")),
      );
      const composer = page.locator(".create-studio textarea");
      await composer.fill("/");
      const picker = page.locator(".composer-picker");
      await expect(picker.getByRole("option")).toHaveCount(3);
      await card(
        page,
        lang,
        "ai-skills",
        [picker, page.locator(".create-studio .inline-chat-bar")],
        { margin: 12 },
      );
    });

    test("ai: models", async ({ page }) => {
      await page.setViewportSize({ width: 860, height: 900 });
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: sample.doc,
        },
      });
      await page.evaluate(() =>
        (
          window as unknown as {
            __devEmitTauriEvent: (name: string) => void;
          }
        ).__devEmitTauriEvent("menu-open-settings"),
      );
      await page
        .locator(".settings-nav-item", { hasText: "Textus AI" })
        .click();
      await page.locator(".provider-picker .combobox-trigger").click();
      const list = page.locator(".combobox-list");
      await expect(list).toBeVisible();
      await card(
        page,
        lang,
        "ai-models",
        [page.locator(".provider-picker .combobox-trigger"), list],
        { margin: 0 },
      );
    });

    /** The plugin cards' notes: the sample's linked notes, on disk. */
    async function openNotes(
      page: Page,
      plugins: Record<string, string[]>,
      settings: Record<string, Record<string, unknown>> = {},
    ) {
      const titles = Object.keys(sample.notes);
      await start(page, {
        lang,
        file: { path: fileIn(sample.folder, titles[0]), content: "" },
        plugins: {
          plugins,
          folder: Object.fromEntries(
            titles.map((t) => [fileIn(sample.folder, t), sample.notes[t]]),
          ),
          settings,
        },
        settings: { plugins: settings },
      });
      await expect(doc(page).locator("h1")).toContainText(titles[0]);
    }

    test("plugin: graph", async ({ page }) => {
      await page.setViewportSize({ width: 720, height: 600 });
      await openNotes(page, {
        "catvinci.graph": ["files.read", "editor.read"],
      });
      await emitTo(page, "menu-plugin-command", "catvinci.graph.open");
      const graph = tabFrame(page);
      await expect(graph.locator("canvas")).toBeVisible();
      await expect(graph.locator("#stats")).toHaveText(/\d/);
      // The layout settles, then fills the tab as Fit does.
      await page.waitForTimeout(5000);
      await graph.locator("#fit").click();
      await page.waitForTimeout(800);
      await card(
        page,
        lang,
        "plugin-graph",
        [page.locator('[data-active-tab="true"] .plugin-webview-frame')],
        { margin: 0, inset: 0 },
      );
    });

    test("plugin: quick preview", async ({ page }) => {
      await page.setViewportSize({ width: 600, height: 760 });
      await openNotes(page, {
        "catvinci.quick-preview": ["editor.read", "files.read"],
      });
      await canned(page, {
        resolve_vault_note: fileIn(sample.folder, sample.previewLink),
      });
      const link = doc(page)
        .locator('[data-type="wikilink"]', { hasText: sample.previewLink })
        .last();
      const preview = page.locator(".hover-card");
      const index = await link.evaluate((el) => {
        const root = el.closest(".ProseMirror")!;
        let block: Element = el;
        while (block.parentElement !== root) block = block.parentElement!;
        return Array.from(root.children).indexOf(block);
      });
      const paragraph = doc(page).locator(":scope > *").nth(index);
      await isolate([paragraph]);
      await page.mouse.move(0, 400);
      await filmCard(
        page,
        lang,
        "plugin-preview",
        (after) => (after ? [paragraph, preview] : [paragraph]),
        async () => {
          await expect(async () => {
            await page.mouse.move(0, 400);
            await link.hover();
            await expect(preview).toBeVisible({ timeout: 1500 });
          }).toPass();
          await page.waitForTimeout(600);
        },
      );
    });

    test("plugin: vim", async ({ page }) => {
      // Tall enough for the whole note: a scroll to the caret would cut
      // its first line.
      await page.setViewportSize({ width: 680, height: 640 });
      await openNotes(page, { "catvinci.vim": ["editor.input"] });
      const status = page.locator(".plugin-status-item");
      await expect(status).toContainText("--");
      // Flash: s and a letter, every place it is on screen labelled with
      // the key that jumps there - and the mode in the window bar.
      // The block cursor at the note's last line's end, off its links; the
      // note from its title.
      await doc(page).locator(":scope > p").last().click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("$");
      await doc(page)
        .locator("h1")
        .evaluate((h1) => h1.scrollIntoView({ block: "start" }));
      const letter = await doc(page).evaluate((root) => {
        const counts = new Map<string, number>();
        for (const ch of (root as HTMLElement).innerText.toLowerCase())
          if (/\p{L}/u.test(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
        return [...counts].sort((a, b) => b[1] - a[1])[0][0];
      });
      const shell = page.locator(".app-shell");
      const label = page.locator(".plugin-flash-label");
      await filmCard(
        page,
        lang,
        "plugin-vim",
        () => [shell],
        async () => {
          await page.keyboard.press("s");
          // A key no keyboard layout here names: its keydown, as an
          // IME-free layout of that script sends it.
          await doc(page).evaluate((root, key) => {
            root.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
              }),
            );
          }, letter);
          await expect(label.first()).toBeVisible();
          await page.waitForTimeout(1400);
          // The label's key jumps there.
          const key = (await label.nth(2).innerText()).trim();
          await page.keyboard.press(key);
          await expect(label).toHaveCount(0);
          await page.waitForTimeout(300);
        },
        { margin: 0, inset: 0 },
      );
    });

    test("plugin: version history", async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 560 });
      // A morning's work: saves a quarter of an hour apart are versions.
      await page.clock.install({ time: new Date("2026-10-27T09:12:00") });
      await openNotes(
        page,
        {
          "catvinci.version-history": [
            "files.read",
            "editor.read",
            "editor.propose",
          ],
        },
        { "catvinci.version-history": { every: "0" } },
      );
      // Two saves, each after a line of links at the note's end.
      const titles = Object.keys(sample.notes);
      for (const title of titles.slice(1, 4)) {
        await doc(page).locator(":scope > p").last().click();
        await page.keyboard.press("ControlOrMeta+ArrowDown");
        await page.keyboard.press("Enter");
        await page.keyboard.type(`[[${title}]]`);
        await emitTo(page, "menu-save-file");
        await page.clock.runFor(1500);
        await page.clock.fastForward(16 * 60_000);
      }
      // The caret off the last link, so its brackets go; the note from its
      // title, where typing at its end had scrolled it.
      await doc(page).locator(":scope > p").first().click();
      await doc(page)
        .locator("h1")
        .evaluate((h1) => h1.scrollIntoView({ block: "start" }));
      if (await page.locator(".sidebar.sidebar-collapsed").count())
        await emitTo(page, "menu-toggle-sidebar");
      await page
        .locator(".sidebar-tabs")
        .getByRole("button", {
          name: pluginWord(
            "catvinci.version-history",
            "history",
            LANGUAGES[lang].ui,
          ),
        })
        .click();
      const history = page.frameLocator(".sidebar .plugin-webview-frame");
      await expect(
        history.locator("#versions > li:not(.day-head)").first(),
      ).toBeVisible();
      await page.waitForTimeout(500);
      await card(page, lang, "plugin-history", [page.locator(".app-shell")], {
        margin: 0,
        inset: 0,
      });
    });

    test("diagram", async ({ page }) => {
      test.skip(!extra, `no README texts for ${lang}`);
      await open(
        page,
        sample.mathTitle,
        `# ${sample.mathTitle}\n\n\`\`\`mermaid\nflowchart LR\n  ${extra.flow}\n\`\`\`\n`,
      );
      const diagram = doc(page).locator(".mermaid-preview").first();
      await expect(diagram.locator("svg")).toBeVisible();
      await isolate([diagram]);
      await card(page, lang, "diagram", [diagram.locator("svg")], {
        margin: 12,
      });
    });

    test("formula", async ({ page }) => {
      await open(page, sample.mathTitle, sample.mathDoc);
      await expect(doc(page).locator(".katex-display").first()).toBeVisible();
      // The paragraphs with formulas, and the display formula between.
      const inline = doc(page).locator(":scope > p", {
        has: page.locator(".katex"),
      });
      const formula = [
        inline.first(),
        doc(page).locator(":scope > *", {
          has: page.locator(".katex-display"),
        }),
        inline.nth(1),
      ];
      await isolate(formula);
      await card(page, lang, "formula", formula);
    });
  });
}
