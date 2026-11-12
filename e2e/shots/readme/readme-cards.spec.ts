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
    flow: `A[Observe] --> B{Does it fit every fact?}
  B -- Yes --> C[Deduce]
  B -- No --> D[Look again]
  D --> A`,
    continuation: " Every case after it follows the same method.",
    slip: {
      sentence: "Holmes and Watson was sharing the rooms at Baker Street.",
      wrong: "was",
      right: "were",
      issue: "“Holmes and Watson” takes “were”.",
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
  {
    margin = 20,
    inset = 18,
    aspect = CARD,
    width = 640,
  }: { margin?: number; inset?: number; aspect?: number; width?: number } = {},
) {
  await page.evaluate(() => document.fonts.ready);
  await scrollIn(targets(false)[0]);
  await film(
    page,
    cardFile(lang, name),
    targets,
    act,
    { aspect, width, inset },
    margin,
  );
}

/** Every README picture is the whole window, 16:9, framed alike. */
const WINDOW = { width: 1440, height: 810 };
const WIDE = { margin: 0, frame: 1200, aspect: 16 / 9, inset: 0 };

/** The whole window as it is now. */
function windowCard(page: Page, lang: string, name: string) {
  return card(page, lang, name, [page.locator(".app-shell")], WIDE);
}

/** The whole window while `act` plays. */
function windowFilm(
  page: Page,
  lang: string,
  name: string,
  act: () => Promise<void>,
) {
  return filmCard(page, lang, name, () => [page.locator(".app-shell")], act, {
    margin: 0,
    inset: 0,
    aspect: 16 / 9,
    width: 1200,
  });
}

/** The app opened as shot-kit's launch does, with this Mac's code font. */
async function start(page: Page, options: Parameters<typeof launch>[1]) {
  // The card that offers Two-way Links for a document with [[links]] is put away.
  await launch(page, {
    ...options,
    // Large words in a small card; the tour's window keeps its own.
    settings: { zoom: 1.35, ...options.settings },
    storage: {
      "textus-plugin-card-answers": JSON.stringify({
        "content:wikilinks": "never",
      }),
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

/** The knowledge-base page of the database card: its title and a line. */
const BASE_PAGE: Record<string, [string, string]> = {
  en: ["Knowledge base", "Every note on the book, one entry each."],
  zh: ["知识库", "关于这本书的每篇笔记，一篇一个条目。"],
  "zh-hant": ["知識庫", "關於這本書的每篇筆記，一篇一個條目。"],
  ja: ["ナレッジベース", "この本についてのノートを、一件ずつ。"],
  ko: ["지식 베이스", "이 책에 관한 노트를 하나씩 정리합니다."],
  es: [
    "Base de conocimiento",
    "Cada nota sobre el libro, una entrada cada una.",
  ],
  fr: ["Base de connaissances", "Chaque note sur le livre, une fiche chacune."],
  de: ["Wissensbasis", "Jede Notiz zum Buch, ein Eintrag pro Notiz."],
  ru: ["База знаний", "Каждая заметка о книге — отдельная запись."],
  pt: [
    "Base de conhecimento",
    "Cada nota sobre o livro, uma entrada para cada.",
  ],
};

/** A base's property keys in each README language: status, words, links. */
const BASE_KEYS: Record<string, [string, string, string]> = {
  en: ["Status", "Words", "Links"],
  zh: ["状态", "字数", "链接"],
  "zh-hant": ["狀態", "字數", "連結"],
  ja: ["ステータス", "文字数", "リンク"],
  ko: ["상태", "단어 수", "링크"],
  es: ["Estado", "Palabras", "Enlaces"],
  fr: ["Statut", "Mots", "Liens"],
  de: ["Status", "Wörter", "Links"],
  ru: ["Статус", "Слова", "Ссылки"],
  pt: ["Status", "Palavras", "Links"],
};

/** Skills from the store as `list_skills` answers once they are
 *  installed: each file's name, category, modes and labels per language. */
const STORE_SKILLS = [
  "continue-story",
  "describe",
  "dialogue",
  "tighten",
  "translate",
  "de-ai",
  "summarize",
  "headline",
];
function storeSkills(names: string[]) {
  const root = pluginsCheckout();
  if (!root)
    throw new Error("no textus-plugins checkout: set TEXTUS_PLUGINS_DIR");
  return names.map((name) => {
    const text = readFileSync(path.join(root, "skills", `${name}.md`), "utf8");
    const meta = (key: string) =>
      new RegExp(`^ {2}textus-${key}: "([^"]*)"`, "m").exec(text)?.[1];
    const labels: Record<
      string,
      { label: string; hint: string; aliases: string[] }
    > = {};
    for (const m of text.matchAll(/^ {2}textus-label-([\w-]+): "([^"]*)"/gm))
      labels[m[1]] = {
        label: m[2],
        hint: meta(`hint-${m[1]}`) ?? "",
        aliases: [],
      };
    return {
      name,
      description: labels.en?.hint ?? name,
      prompt: "",
      category: meta("category") ?? null,
      invocation: meta("invocation") ?? "both",
      modes: (meta("modes") ?? "write").split(/,\s*/),
      source: "global",
      overridesBuiltin: false,
      packs: [],
      version: meta("version") ?? "1.0.0",
      basedOn: null,
      builtinUpdated: false,
      off: false,
      aliases: {},
      labels,
    };
  });
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

/** The document's editor: the one in sight, whichever tab is in use (the
 *  AI's, once a request is sent). */
const doc = (page: Page) => page.locator(".ProseMirror:visible").first();

for (const lang of LANGS) {
  const sample = SAMPLES[lang] as Sample;
  const extra = EXTRA[lang];

  test.describe(`README pictures (${lang})`, () => {
    test.use({ locale: LANGUAGES[lang].locale });

    test("writing", async ({ page }) => {
      // Two islands of one window, words large: the sample's notes with a
      // table and code on the left, math and a diagram on the right.
      const table =
        /^\|.*\|\n\|[-:| ]+\|\n(?:\|.*\|\n?)+/m.exec(sample.doc)?.[0] ??
        extra?.table ??
        "";
      // The tour's reading notes: every kind of mark, a callout, lists and code.
      const tour = sample.tourDoc;
      const reading = tour.includes("\n### ")
        ? tour.slice(tour.indexOf("\n### ") + 1).replace(/\n---\n*$/, "\n")
        : /```[\s\S]*?\n```/.exec(tour)![0];
      // Left: the marks, the picture and the table, a list last. Right: the
      // math, then the callout and code, then the diagram.
      const code = /```[\s\S]*?\n```\n/.exec(reading)?.[0] ?? "";
      const callout = /^> \[![\s\S]*?\n(?!>)/m.exec(reading)?.[0] ?? "";
      const rest = reading.replace(code, "").replace(callout, "");
      const lists = rest.search(/^(?:- |1\. )/m);
      const head = lists < 0 ? rest : rest.slice(0, lists);
      // One numbered list of three: the steps, then the open to-dos.
      const steps = [
        ...rest.matchAll(/^\d+\. (.*)$/gm),
        ...rest.matchAll(/^- \[ \] (.*)$/gm),
      ].map((m) => m[1]);
      const tail = steps
        .slice(0, 3)
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      const picture = `<img src="illustration.webp" alt="${sample.title}" width="64%">`;
      const notes = `# ${sample.title}\n\n${head.trimEnd()}\n\n${picture}\n\n${table}\n\n${tail}`;
      // The math without its closing remark, so the diagram fits too.
      const formula = sample.mathDoc.split("```mermaid")[0].trimEnd();
      const last = formula.lastIndexOf("\n\n");
      const math = `${/\$/.test(formula.slice(last)) ? formula : formula.slice(0, last)}\n\n${callout}\n${code}`;
      const flow = extra
        ? `\n\n\`\`\`mermaid\nflowchart LR\n  ${extra.flow}\n\`\`\`\n`
        : "\n";
      const left = fileIn(sample.folder, sample.title);
      const right = fileIn(sample.folder, sample.mathTitle);
      await page.setViewportSize(WINDOW);
      await start(page, {
        lang,
        file: { path: left, content: notes },
        plugins: {
          plugins: {},
          folder: { [left]: notes, [right]: math + flow },
        },
        settings: { zoom: 1 },
      });
      await emitTo(page, "menu-split-right");
      await emitTo(page, "open-paths-as-tabs", [right]);
      // The blank tab the split opened with goes.
      const blank = page.locator(".tab-pill").filter({ hasNotText: /\.md$/ });
      await expect(page.locator(".tab-pill")).toHaveCount(3);
      await blank.hover();
      await blank.locator(".tab-pill-close").click();
      await expect(page.locator(".tab-pill")).toHaveCount(2);
      await expect(page.locator(".katex-display").first()).toBeVisible();
      if (extra)
        await expect(
          page.locator(".mermaid-preview svg").first(),
        ).toBeVisible();
      await expect(page.locator(".ProseMirror table").first()).toBeVisible();
      await page.locator(".ProseMirror").first().click();
      await page.keyboard.press("ControlOrMeta+Home");
      // The pointer off the page: a picture under it shows its handles.
      await page.mouse.move(2, 2);
      await page.waitForTimeout(600);
      await windowCard(page, lang, "writing");
    });

    /** The sample with its picture moved under the note, so the passage
     *  and the note the AI works on come first; the lines between the title
     *  and the passage go, so the picture fits under them. */
    const noteFirst = (text: string) => {
      const picture = /\n<img [^>]*>\n/.exec(text)?.[0] ?? "";
      const rest = text
        .replace(picture, "\n")
        .replace(/^(# .*\n)[\s\S]*?(?=^> )/m, "$1\n");
      const at = rest.indexOf("\n", rest.indexOf(sample.anchor));
      return `${rest.slice(0, at)}\n${picture}${rest.slice(at)}`;
    };

    async function openNote(page: Page, panel = false) {
      await page.setViewportSize(WINDOW);
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: noteFirst(sample.doc),
        },
        project: {
          root: `/Users/me/Documents/${sample.folder}`,
          library: sample.library,
        },
        settings: { enableCompletion: true, zoom: panel ? 1 : 1.2 },
      });
      // The AI's conversation, opened as a person opens it.
      if (panel) {
        await page.getByRole("button", { name: "Textus AI" }).first().click();
        // The document back in use beside it, as after clicking into it.
        await page
          .locator(".tab-pill", { hasText: sample.title })
          .first()
          .click();
      }
    }

    /** The note's paragraph the edit rewrites. */
    const note = (page: Page) =>
      doc(page).locator(":scope > p", { hasText: sample.anchor.slice(0, 8) });

    /** The AI's answer to the sample's ask: an edit to the note and a
     *  comment on the passage. */
    const exchange = () => [
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
    ];

    test("ai: edits and a comment", async ({ page }) => {
      await openNote(page, true);
      await canned(page, { ai_agent_message: exchange() });
      const composer = page.locator(".agent-panel-view textarea");
      const comment = page.locator(".agent-comment").first();
      // The request going and the edits coming in, the note in sight.
      await note(page).evaluate((p) => p.scrollIntoView({ block: "center" }));
      await windowFilm(page, lang, "ai-revise", async () => {
        await composer.fill(sample.ask);
        await composer.press("Enter");
        await expect(comment).toBeVisible();
        await expect(
          doc(page).locator(".pending-sentence").first(),
        ).toBeAttached();
        await page.waitForTimeout(1200);
      });
      await composer.blur();
      await page.mouse.move(2, 2);
      // The hero: the document from its top, the passage and its comment.
      await doc(page).evaluate((d) => d.closest(".editor-scroll")?.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await windowCard(page, lang, "hero");
      // The edits taken: the review comment beside its sentence is left.
      await page.locator(".agent-proposal-actions button").first().click();
      await expect(doc(page).locator(".pending-sentence")).toHaveCount(0);
      await doc(page)
        .locator("h1")
        .evaluate((h) => h.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(400);
      await windowCard(page, lang, "ai-review");
    });

    test("ai: continuation", async ({ page }) => {
      test.skip(!extra, `no README texts for ${lang}`);
      await openNote(page);
      await canned(page, { ai_complete: extra.continuation });
      const paragraph = note(page);
      const text = (await paragraph.innerText()).trim();
      await caretAfter(page, text.slice(-8), true);
      await paragraph.evaluate((p) => p.scrollIntoView({ block: "center" }));
      // Mid-document, a continuation comes on request; Tab takes it.
      await windowFilm(page, lang, "ai-continue", async () => {
        await page.keyboard.press("ControlOrMeta+Shift+Space");
        await expect(page.locator(".ghost-text")).toHaveAttribute(
          "data-suggestion",
          extra.continuation,
        );
        await page.waitForTimeout(1400);
        await page.keyboard.press("Tab");
        await expect(page.locator(".ghost-text")).toHaveCount(0);
        await page.waitForTimeout(300);
      });
    });

    test("ai: grammar", async ({ page }) => {
      test.skip(!extra, `no README texts for ${lang}`);
      const { sentence, wrong, right, issue } = extra.slip;
      const at = Array.from(sentence.slice(0, sentence.indexOf(wrong))).length;
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: `# ${sample.title}\n\n${sample.anchor}\n\n`,
        },
        settings: { enableGrammarCheck: true, zoom: 1.2 },
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
      await page.setViewportSize(WINDOW);
      await doc(page).locator(":scope > *").last().click();
      // The document's end: End on a Mac scrolls.
      await page.keyboard.press("ControlOrMeta+ArrowDown");
      await page.keyboard.press("Enter");
      // The new paragraph, by position: hovering redraws the underline.
      const index = (await doc(page).locator(":scope > *").count()) - 1;
      const paragraph = doc(page).locator(":scope > *").nth(index);
      const underline = doc(page).locator(".grammar-issue");
      const popover = page.locator(".grammar-popover");
      void paragraph;
      await windowFilm(page, lang, "ai-grammar", async () => {
        await page.keyboard.type(sentence, { delay: 45 });
        await expect(underline).toHaveText(wrong);
        await page.waitForTimeout(500);
        await underline.hover();
        await expect(popover).toBeVisible();
        await page.waitForTimeout(400);
      });
    });

    test("ai: skills", async ({ page }) => {
      // The whole window: the AI in Write mode, / listing skills from the store.
      await page.setViewportSize(WINDOW);
      await start(page, {
        lang,
        file: {
          path: fileIn(sample.folder, sample.title),
          content: noteFirst(sample.doc).replace(sample.anchor, sample.edited),
        },
        settings: { zoom: 1 },
        storage: {
          "textus-agent-last-mode": JSON.stringify({ mode: "write" }),
        },
      });
      // The conversation after the edit was taken: the note tightened, the
      // comment beside the passage.
      await canned(page, {
        list_skills: storeSkills(STORE_SKILLS),
        ai_agent_message: exchange().filter(
          (m) => !("call_id" in m) || m.call_id !== "e1",
        ),
      });
      await page.getByRole("button", { name: "Textus AI" }).first().click();
      const composer = page.locator(".ai-tab:visible textarea");
      // A conversation under way, then / for a skill.
      await composer.fill(sample.ask);
      await composer.press("Enter");
      await expect(page.locator(".ai-tab:visible")).toContainText(sample.reply);
      await composer.fill("/");
      const picker = page.locator(".ai-tab:visible .composer-picker");
      await expect(picker.getByRole("option")).toHaveCount(STORE_SKILLS.length);
      await picker
        .locator(".composer-picker-list")
        .evaluate((list) => list.scrollTo(0, 0));
      await windowCard(page, lang, "ai-skills");
    });

    test("ai: models", async ({ page }) => {
      await page.setViewportSize(WINDOW);
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
        ).__devEmitTauriEvent("menu-settings"),
      );
      // Textus AI › Models: the model choice over the
      // providers, list and picked one side by side.
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("textus:open-settings-page", {
            detail: { page: "providers" },
          }),
        ),
      );
      // The providers, list and picked one side by side.
      const providers = page.locator(".providers-page");
      // The providers' group from its title, nothing above it cut.
      await providers.evaluate((el) =>
        (el.closest(".settings-group") ?? el).scrollIntoView({ block: "start" }),
      );
      await expect(providers.locator(".providers-detail")).toBeVisible();
      await page.waitForTimeout(400);
      await windowCard(page, lang, "ai-models");
    });

    /** The plugin cards' notes: the sample's linked notes, on disk. */
    async function openNotes(
      page: Page,
      plugins: Record<string, string[]>,
      settings: Record<string, Record<string, unknown>> = {},
      /** The first note as it stands on disk, when not as written. */
      first?: string,
    ) {
      const titles = Object.keys(sample.notes);
      const text = (t: string) =>
        t === titles[0] && first !== undefined ? first : sample.notes[t];
      await start(page, {
        lang,
        file: { path: fileIn(sample.folder, titles[0]), content: "" },
        plugins: {
          plugins,
          folder: Object.fromEntries(
            titles.map((t) => [fileIn(sample.folder, t), text(t)]),
          ),
          settings,
        },
        settings: { plugins: settings, zoom: 1 },
      });
      await expect(doc(page).locator("h1")).toContainText(titles[0]);
    }

    test("plugin: graph", async ({ page }) => {
      await page.setViewportSize(WINDOW);
      await openNotes(page, {
        "catvinci.graph": ["files.read", "editor.read"],
      });
      // The note on the left, its graph in an island beside it.
      await emitTo(page, "menu-split-right");
      await emitTo(page, "menu-plugin-command", "catvinci.graph.open");
      const blank = page.locator(".tab-pill").filter({ hasNotText: /\.md$|Graph|图|圖|グラフ|그래프|Grafo|Graphe|Graph|Граф/ });
      if (await blank.count()) {
        await blank.first().hover();
        await blank.first().locator(".tab-pill-close").click();
      }
      const graph = tabFrame(page);
      await expect(graph.locator("canvas")).toBeVisible();
      await expect(graph.locator("#stats")).toHaveText(/\d/);
      // The layout settles, then fills the tab as Fit does.
      await page.waitForTimeout(5000);
      await graph.locator("#fit").click();
      await page.waitForTimeout(1500);
      // Once more, the layout settled at this size.
      await graph.locator("#fit").click();
      await page.waitForTimeout(1200);
      await windowCard(page, lang, "plugin-graph");
    });

    test("plugin: quick preview", async ({ page }) => {
      await page.setViewportSize(WINDOW);
      await openNotes(page, {
        "catvinci.quick-preview": ["editor.read", "files.read"],
      });
      await canned(page, {
        resolve_note_link: {
          path: fileIn(sample.folder, sample.previewLink),
          exists: true,
        },
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
      await paragraph.evaluate((p) => p.scrollIntoView({ block: "center" }));
      await page.mouse.move(2, 2);
      await windowFilm(page, lang, "plugin-preview", async () => {
        await expect(async () => {
          await page.mouse.move(2, 2);
          await link.hover();
          await expect(preview).toBeVisible({ timeout: 1500 });
        }).toPass();
        await page.waitForTimeout(600);
      });
    });

    test("plugin: database", async ({ page }) => {
      // A base of the sample's notes: each note a row, its properties the
      // columns, the keys and values in the language.
      const ui = LANGUAGES[lang].ui;
      const [status, words, links] = BASE_KEYS[lang] ?? BASE_KEYS.en;
      const states = ["todo", "doing", "done"].map((key) =>
        pluginWord("catvinci.kanban", key, ui),
      );
      const titles = Object.keys(sample.notes);
      const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
      const folder: Record<string, string> = {};
      titles.forEach((title, i) => {
        const body = sample.notes[title];
        const text = body.replace(/^#.*$/gm, "").replace(/\[\[|\]\]/g, "");
        const count = cjk.test(text)
          ? text.replace(/\s/g, "").length
          : text.split(/\s+/).filter(Boolean).length;
        const linked = (body.match(/\[\[/g) ?? []).length;
        folder[fileIn(sample.folder, title)] =
          `---\n${status}: ${states[i % 3]}\n${words}: ${count}\n${links}: ${linked}\n---\n\n${body}`;
      });
      // A Notion-style page: an icon, and its entries as a table in it; the
      // entries are its sub-pages, beside it in its folder.
      const [pageTitle, intro] = BASE_PAGE[lang] ?? BASE_PAGE.en;
      const dir = `${sample.folder}/${pageTitle}`;
      const entries: Record<string, string> = {};
      for (const [path0, text] of Object.entries(folder))
        entries[fileIn(dir, path0.split("/").pop()!.slice(0, -3))] = text;
      const pagePath = fileIn(dir, pageTitle);
      const pageDoc = `# ${pageTitle}\n\n${intro}\n\n\`\`\`base
filters:
  and:
    - file.inFolder(this.file.folder)
    - file.path != this.file.path
views:
  - type: table
    name: ${pluginWord("catvinci.database", "table", ui)}
    order:
      - file.name
      - ${status}
      - ${words}
      - ${links}
\`\`\`
`;
      entries[pagePath] = pageDoc;
      await page.setViewportSize(WINDOW);
      await start(page, {
        lang,
        file: { path: pagePath, content: pageDoc },
        plugins: {
          plugins: {
            "catvinci.database": [
              "files.read",
              "files.write",
              "editor.read",
              "editor.write",
            ],
          },
          folder: entries,
        },
        settings: { zoom: 1 },
      });
      const table = page
        .frameLocator(".ProseMirror .plugin-webview-frame")
        .first();
      await expect(
        table.locator("tbody tr", { hasText: titles[1] }),
      ).toBeVisible();
      // The sidebar's Pages tab: the page and its entries as a tree.
      await page
        .getByRole("button", {
          name: pluginWord("catvinci.database", "pages.name", ui),
        })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(800);
      await windowCard(page, lang, "plugin-database");
    });

    test("plugin: version history", async ({ page }) => {
      await page.setViewportSize(WINDOW);
      // A morning's work: saves a quarter of an hour apart are versions.
      await page.clock.install({ time: new Date("2026-10-27T09:12:00") });
      // The note's last paragraph written in three sittings, each saved.
      const titles = Object.keys(sample.notes);
      const whole = sample.notes[titles[0]].trimEnd();
      const cut = whole.lastIndexOf("\n\n");
      // Three parts by length, typed as plain words: a link typed whole
      // keeps the caret inside it.
      const last = whole.slice(cut + 2).replace(/\[\[|\]\]/g, "");
      const ends = [1, 2].map((k) => {
        let at = Math.round((last.length * k) / 3);
        while (at < last.length && !/[\s，、,]/.test(last[at - 1])) at++;
        return at;
      });
      const parts = [0, ...ends, last.length]
        .slice(0, 3)
        .map((from, i) => last.slice(from, [...ends, last.length][i]));
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
        `${whole.slice(0, cut)}\n`,
      );
      for (let i = 0; i < 3; i++) {
        if (i === 0) {
          // Out of the list above, into a paragraph of its own.
          await doc(page).locator(":scope > *").last().click();
          await page.keyboard.press("ControlOrMeta+ArrowDown");
          await page.keyboard.press("Enter");
          await page.keyboard.press("Enter");
        } else {
          await caretAfter(page, parts[i - 1].slice(-8), true);
        }
        await page.keyboard.type(parts[i]);
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
        .locator(".activity-rail")
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
      await windowCard(page, lang, "plugin-history");
    });
  });
}
