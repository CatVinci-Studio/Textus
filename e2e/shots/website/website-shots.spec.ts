/**
 * The website's app screenshots: the app as the site shows it - the light
 * appearance and the Default theme (a white page, like the site's), a
 * 1440x900 window at 2x, on a Mac - one set per site language. Not a test:
 * nothing is compared. Run `npm run screenshots:website` after a visible UI
 * change and copy the images into the site.
 *
 * Each shot is <out>/<lang>/<name>.png (2880x1800) with a 1920-wide
 * <name>.webp beside it:
 *   hero      a classic text and a reader's note on it, the AI panel beside
 *             them with one proposed edit to the note (its reason and its
 *             two sentences, in the margin as well when there is room) and
 *             one review comment on the classic
 *   split     split view: the Markdown source beside the page
 *   zen       zen mode, the passage being read lit
 *   math      a KaTeX formula block, inline math and a Mermaid mind map
 *   math-live the same with the caret in the formula: its source open, the
 *             live preview under the caret
 *   markdown  the Markdown tour: headings, bold, italic, underline,
 *             strikethrough, highlight, inline code, a link, the three
 *             kinds of list, a quote, a GitHub alert, a
 *             highlighted code block and a rule, all rendered at once (the
 *             document zoomed out a step, so it fits one screen)
 *   settings  Settings, the AI page, its list of providers open
 *
 * Fonts: where a Mac draws San Francisco the shots draw Inter, and code is
 * in JetBrains Mono (second in the app's monospace stack), when their files
 * are on this machine; KaTeX's own fonts are served even when node_modules
 * is a link to another checkout (a worktree), which Vite refuses to serve.
 *
 * Environment:
 *   LANGS           site language codes, comma-separated (default en,zh,ja;
 *                   any of en zh zh-hant ja ko es fr de ru pt). The UI is in
 *                   that language where the app has it, and English where
 *                   it doesn't yet.
 *   SAMPLES_JSON    a JSON file of { "<lang>": Sample } (see Sample below):
 *                   the texts of languages beyond the built-in three, or
 *                   fields that replace built-in ones. A shot whose texts a
 *                   language lacks is skipped. e2e/shots/website/site-samples.json
 *                   has the other seven site languages, each on the site's
 *                   own classic for that language.
 *   SHOTS_OUT       where the images go (default ../assets/site-assets/
 *                   app, beside the main checkout).
 *   SHOTS_APP_NAME  the product name the UI shows (default Textus: the site
 *                   is for 1.0, and names the app no other way).
 *   SHOTS_FONT_DIR  a folder with Inter's .otf files (Inter-Regular.otf
 *                   etc.), drawn where a Mac draws San Francisco. Found in
 *                   TeX Live's fonts when it is installed; without it the UI
 *                   is in this machine's own fallback.
 *   SHOTS_CJK_FONT_DIR  the Simplified Chinese, Traditional Chinese and
 *                   Japanese Noto Sans CJK faces as separate files, for the
 *                   zh, zh-hant and ja shots (see CJK_REGION below; default
 *                   ../assets/fonts/noto-cjk-faces beside the checkout).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openApp } from "../../helpers";

/** One language's texts, all Markdown. `anchor`, `commentAnchor`,
 *  `zenFocus` and `tourCaret` are quoted verbatim from their documents. */
interface Sample {
  /** The hero document's name: its file name (<title>.md) and H1. */
  title: string;
  /** The project folder the AI panel shows, and its library's entries. */
  folder: string;
  library: string[];
  /** The hero document: a classic passage, then a reader's note on it. */
  doc: string;
  /** What the user asks the AI panel. */
  ask: string;
  /** The passage the proposed edit replaces, and its replacement. The
   *  first and last sentences change and the middle one stays: two
   *  changes, so the sentence picker has two rows. */
  anchor: string;
  edited: string;
  /** Why, as the proposal gives it. */
  reason: string;
  /** Where the review comment is pinned, and what it says. */
  commentAnchor: string;
  comment: string;
  /** The assistant's closing line. */
  reply: string;
  /** The start of the paragraph zen mode lights. */
  zenFocus: string;
  /** The math document's name, and the document: a $$ block, inline math
   *  and a mermaid mind map. */
  mathTitle: string;
  mathDoc: string;
  /** The Markdown tour's name and document: every kind of mark at once. */
  tourTitle: string;
  tourDoc: string;
  /** Plain words in the tour where the caret rests - away from every
   *  mark, so none of them shows its Markdown. */
  tourCaret: string;
  /** The AI panel's width in the hero, as a user drags it (optional; the
   *  app's default otherwise): wider where the language's labels need it
   *  to keep the proposal's buttons on one row. */
  panelWidth?: number;
}

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
} satisfies Record<string, (keyof Sample)[]>;
type Shot = keyof typeof NEEDS;

/** The app draws diagrams in mermaid's "neutral" theme, whose first
 *  branch colour (cScale1) is #f4f4f4: a mind map's first branch comes out
 *  as white boxes joined by white lines on the light diagram box. Each
 *  mermaid block in a math document gets a config that gives that branch a
 *  grey of the same scale instead - as any user can write in a diagram,
 *  and hidden in these shots, where the caret is away from it. */
function mindmapColours(doc: string): string {
  return doc.replace(
    /^```mermaid\n(?!---)/gm,
    '```mermaid\n---\nconfig:\n  themeVariables:\n    cScale1: "#999999"\n---\n',
  );
}

const BUILT_IN: Record<string, Sample> = {
  en: {
    title: "Hamlet",
    folder: "Shakespeare",
    library: ["Hamlet", "Ophelia", "Claudius", "Elsinore"],
    doc: `# Hamlet

## Act III, Scene 1

*A room in the castle.* Enter **Hamlet**.

> To be, or not to be, that is the question:\\
> Whether 'tis nobler in the mind to suffer\\
> The slings and arrows of outrageous fortune,\\
> Or to take arms against a sea of troubles\\
> And by opposing end them.

## Notes

Hamlet's question is not really only about whether to live or to die, if you think about it. He is weighing whether it is nobler to endure what fortune sends or to fight it. In the end, it seems to be the fear of what might come after death that is the thing that keeps him from acting.

| Line | Image             | Reading                   |
| ---- | ----------------- | ------------------------- |
| 3    | Slings and arrows | Fortune as an archer      |
| 4    | A sea of troubles | A fight no one can win    |
| 5    | End them          | The troubles, or his life |
`,
    ask: "Tighten my note",
    anchor:
      "Hamlet's question is not really only about whether to live or to die, if you think about it. He is weighing whether it is nobler to endure what fortune sends or to fight it. In the end, it seems to be the fear of what might come after death that is the thing that keeps him from acting.",
    edited:
      "Hamlet's question is not only whether to live or die. He is weighing whether it is nobler to endure what fortune sends or to fight it. In the end, the fear of what comes after death keeps him from acting.",
    reason:
      "Cut the hedges (“really”, “if you think about it”, “it seems to be”); the reading is unchanged.",
    commentAnchor: "Or to take arms against a sea of troubles",
    comment:
      "A mixed metaphor on purpose: no one can take arms against the sea. Worth a line in your note.",
    reply: "Tightened your note, and left a comment on the fourth line.",
    zenFocus: "To be, or not to be",
    mathTitle: "Euler",
    mathDoc: `# Euler's formula

For every real number $x$,

$$
e^{ix} = \\cos x + i\\sin x
$$

At $x = \\pi$ it becomes Euler's identity, $e^{i\\pi}+1=0$.

Five of the most important numbers in mathematics, in one line.

\`\`\`mermaid
mindmap
  root((Euler's identity))
    e
      Growth
      Compound interest
    i
      Rotation
      √−1
    π
      Circles
      Waves
    1 and 0
      Unity
      Nothing
\`\`\`
`,
    tourTitle: "Hamlet, Act III",
    tourDoc: `# Hamlet

## Act III, Scene 1

> To be, or not to be, that is the question:\\
> Whether 'tis nobler in the mind to suffer

### Reading notes

The speech turns on **one choice**, *to suffer* or *to take arms*, and ==the dread of something after death== settles it. Not ~~despair~~ but <u>conscience</u> makes cowards of us all. Search the play for \`sea of troubles\`, or read it at [Folger Shakespeare](https://www.folger.edu/explore/shakespeares-works/hamlet/).

> [!NOTE]
> Claudius and Polonius are hiding nearby, listening.

- Fortune as an archer
- Troubles as a sea

1. Read the speech aloud
2. Mark every question

- [x] Learn the first five lines
- [ ] Compare the First Quarto

\`\`\`python
speech = open("hamlet-3-1.txt").read()
print(speech.count("?"), "questions")
\`\`\`

---
`,
    tourCaret: "The speech turns on",
  },
  zh: {
    title: "红楼梦",
    folder: "红楼梦笔记",
    library: ["甄士隐", "贾雨村", "通灵宝玉", "青埂峰"],
    doc: `# 红楼梦

## 第一回\u3000甄士隐梦幻识通灵\u3000贾雨村风尘怀闺秀

> 此开卷第一回也。作者自云：因曾历过一番梦幻之后，故将真事隐去，而借“通灵”之说，撰此《石头记》一书也。故曰“甄士隐”云云。
>
> 但书中所记何事何人？自又云：“今风尘碌碌，一事无成，忽念及当日所有之女子，一一细考较去，觉其行止见识，皆出于我之上。……”

## 读书笔记

这一段其实是作者在交代写作的缘由，可以说是全书的一个总纲。作者把真事隐去，借“通灵”之说来写。“甄士隐”谐音“真事隐”，从某种意义上来说，这也就是这部书最核心的一个写法。

| 人物 | 谐音 | 寓意 |
|---|---|---|
| 甄士隐 | 真事隐 | 真事隐去 |
| 贾雨村 | 假语存 | 假语村言 |
| 甄英莲 | 真应怜 | 身世堪怜 |
`,
    ask: "把我的笔记改得更简洁",
    anchor:
      "这一段其实是作者在交代写作的缘由，可以说是全书的一个总纲。作者把真事隐去，借“通灵”之说来写。“甄士隐”谐音“真事隐”，从某种意义上来说，这也就是这部书最核心的一个写法。",
    edited:
      "这一段交代写作缘由，是全书的总纲。作者把真事隐去，借“通灵”之说来写。“甄士隐”谐音“真事隐”，这正是全书最核心的写法。",
    reason: "删去“其实”“可以说”“从某种意义上来说”这类虚词，意思不变。",
    commentAnchor: "故将真事隐去",
    comment: "“真事隐去”与后文的“假语村言”（贾雨村）相对，笔记里可以点明。",
    reply: "已精简你的笔记，并在原文处留了一条批注。",
    zenFocus: "此开卷第一回也",
    mathTitle: "欧拉公式",
    mathDoc: `# 欧拉公式

对任意实数 $x$，

$$
e^{ix} = \\cos x + i\\sin x
$$

取 $x = \\pi$，便得到欧拉恒等式 $e^{i\\pi}+1=0$。

数学中最重要的五个数，写进了同一行。

\`\`\`mermaid
mindmap
  root((欧拉恒等式))
    e
      增长
      复利
    i
      旋转
      √−1
    π
      圆
      波
    1 与 0
      单位
      空无
\`\`\`
`,
    tourTitle: "红楼梦·第一回",
    tourDoc: `# 红楼梦

## 第一回\u3000甄士隐梦幻识通灵

> 满纸荒唐言，一把辛酸泪！\\
> 都云作者痴，谁解其中味？

### 读书笔记

开卷先交代**写作缘由**：作者把*真事*隐去，借“通灵”之说写成此书。第一回不是~~闲笔~~，==而是全书的总纲==。<u>甄士隐</u>即“真事隐”，<u>贾雨村</u>即“假语存”。全文搜索 \`通灵\` 可以找到伏笔，原文见[维基文库](https://zh.wikisource.org/wiki/紅樓夢)。

> [!NOTE]
> 第一回提到的书名还有《情僧录》《风月宝鉴》《金陵十二钗》。

- 甄士隐：真事隐
- 贾雨村：假语存

1. 通读第一回
2. 摘出谐音人名

- [x] 读完第一回
- [ ] 抄录《好了歌》

\`\`\`python
names = {"甄士隐": "真事隐", "贾雨村": "假语存"}
for name, pun in names.items(): print(name, "→", pun)
\`\`\`

---
`,
    tourCaret: "开卷先",
  },
  ja: {
    title: "吾輩は猫である",
    folder: "漱石を読む",
    library: ["吾輩", "苦沙弥", "迷亭", "寒月"],
    doc: `# 吾輩は猫である

## 冒頭

> 吾輩は猫である。名前はまだ無い。
>
> どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。

## メモ

この冒頭は、ある意味では、猫が語り手であるということをいきなり読者に宣言している書き出しだと言えるのではないかと思う。名前がないことで、猫は人間社会の外側に立っている。そういった意味で、人間を外から眺めるという、この作品全体の視点がここで決まっているのだと言えるだろう。

| 人物 | 肩書き | 吾輩との関係 |
|---|---|---|
| 苦沙弥 | 英語教師 | 主人 |
| 迷亭 | 美学者 | 主人の友人 |
| 寒月 | 理学士 | 主人の元教え子 |
`,
    ask: "メモをもっと簡潔にして",
    anchor:
      "この冒頭は、ある意味では、猫が語り手であるということをいきなり読者に宣言している書き出しだと言えるのではないかと思う。名前がないことで、猫は人間社会の外側に立っている。そういった意味で、人間を外から眺めるという、この作品全体の視点がここで決まっているのだと言えるだろう。",
    edited:
      "この冒頭は、猫が語り手であることをいきなり宣言している。名前がないことで、猫は人間社会の外側に立っている。人間を外から眺めるという作品全体の視点が、ここで決まる。",
    reason:
      "「ある意味では」「〜と言えるのではないかと思う」などの言い回しを削り、主張をはっきりさせました。",
    commentAnchor: "書生という人間中で一番獰悪な種族",
    comment:
      "「獰悪な種族」という大げさな言い方に、猫の目から見た人間の滑稽さが出ています。メモで触れてもよいでしょう。",
    reply: "メモを簡潔にし、本文に一つコメントを残しました。",
    zenFocus: "どこで生れたか",
    mathTitle: "オイラーの公式",
    mathDoc: `# オイラーの公式

任意の実数 $x$ について、

$$
e^{ix} = \\cos x + i\\sin x
$$

$x = \\pi$ とおくと、オイラーの等式 $e^{i\\pi}+1=0$ が得られる。

数学で最も重要な五つの数が、一行に並ぶ。

\`\`\`mermaid
mindmap
  root((オイラーの等式))
    e
      成長
      複利
    i
      回転
      √−1
    π
      円
      波
    1 と 0
      単位
      無
\`\`\`
`,
    tourTitle: "吾輩は猫である・冒頭",
    tourDoc: `# 吾輩は猫である

## 冒頭

> 吾輩は猫である。名前はまだ無い。\\
> どこで生れたかとんと見当がつかぬ。

### 読書メモ

語り手は**猫**で、しかも*名前がない*。==人間を外から眺める視点==が、この一文で決まる。主人の<u>苦沙弥</u>先生は英語教師で、~~悠々自適~~胃弱に悩んでいる。本文で \`書生\` を検索するとよい。全文は[青空文庫](https://www.aozora.gr.jp/cards/000148/card789.html)で読める。

> [!NOTE]
> 1905年に『ホトトギス』で連載が始まった、漱石の最初の長編小説。

- 苦沙弥：主人、英語教師
- 迷亭：美学者

1. 冒頭を音読する
2. 猫の口調をメモする

- [x] 第一章を読む
- [ ] 『坊っちゃん』と比べる

\`\`\`python
cast = {"苦沙弥": "英語教師", "迷亭": "美学者"}
for name, role in cast.items(): print(name, role)
\`\`\`

---
`,
    tourCaret: "語り手",
  },
};

/** Site language code -> the app's UI language and the browser locale. */
const LANGUAGES: Record<string, { ui: string; locale: string }> = {
  en: { ui: "en", locale: "en-US" },
  zh: { ui: "zh", locale: "zh-CN" },
  "zh-hant": { ui: "zh-Hant", locale: "zh-TW" },
  ja: { ui: "ja", locale: "ja-JP" },
  ko: { ui: "ko", locale: "ko-KR" },
  es: { ui: "es", locale: "es-ES" },
  fr: { ui: "fr", locale: "fr-FR" },
  de: { ui: "de", locale: "de-DE" },
  ru: { ui: "ru", locale: "ru-RU" },
  pt: { ui: "pt", locale: "pt-BR" },
};

const LANGS = (process.env.LANGS ?? "en,zh,ja")
  .split(",")
  .map((lang) => lang.trim().toLowerCase())
  .filter(Boolean);
for (const lang of LANGS) {
  if (!LANGUAGES[lang])
    throw new Error(
      `LANGS: unknown language "${lang}" (one of ${Object.keys(LANGUAGES).join(", ")})`,
    );
}

/** The built-in texts, with SAMPLES_JSON's over them. */
function loadSamples(): Record<string, Partial<Sample>> {
  const file = process.env.SAMPLES_JSON;
  const extra: Record<string, Partial<Sample>> = {};
  if (file) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      Partial<Sample>
    >;
    for (const [lang, sample] of Object.entries(parsed))
      extra[lang.toLowerCase()] = sample;
  }
  return Object.fromEntries(
    LANGS.map((lang) => {
      const sample: Partial<Sample> = { ...BUILT_IN[lang], ...extra[lang] };
      if (sample.mathDoc) sample.mathDoc = mindmapColours(sample.mathDoc);
      return [lang, sample];
    }),
  );
}
const SAMPLES = loadSamples();

/** The main checkout, whichever worktree this runs in. */
function mainCheckout(): string {
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    return path.dirname(common);
  } catch {
    // Not a git checkout: the working directory, then.
    return process.cwd();
  }
}
const CHECKOUT = mainCheckout();

/** The folder the images go in: ../assets/site-assets/app beside the
 *  main checkout. */
const OUT = process.env.SHOTS_OUT
  ? path.resolve(process.env.SHOTS_OUT)
  : path.resolve(CHECKOUT, "..", "assets", "site-assets", "app");

const APP_NAME = process.env.SHOTS_APP_NAME ?? "Textus";
/** The Markdown tour's document zoom (Settings' zoom, View > Zoom Out). */
const TOUR_ZOOM = 0.85;
const WEBP_WIDTH = 1920;
const WEBP_QUALITY = 0.85;

/** Fonts a Mac has and this machine may not, as @font-face rules over the
 *  files that stand in for them: Inter where a Mac draws San Francisco
 *  (the UI's stack starts with -apple-system, "SF Pro Text"), and
 *  JetBrains Mono, second in the app's monospace stack, for code. Each is
 *  used when its files are found. */
interface StandInFont {
  family: string;
  weight: number;
  style: "normal" | "italic";
  file: string;
  /** Only these characters (a CSS unicode-range), when set. */
  unicodeRange?: string;
}
function standInFonts(): StandInFont[] {
  const faces: StandInFont[] = [];
  const interDir = [
    process.env.SHOTS_FONT_DIR,
    "/usr/share/texmf-dist/fonts/opentype/public/inter",
    "/usr/share/texlive/texmf-dist/fonts/opentype/public/inter",
  ].find((dir) => dir && existsSync(path.join(dir, "Inter-Regular.otf")));
  if (interDir)
    for (const [name, weight, style] of [
      ["Regular", 400, "normal"],
      ["Italic", 400, "italic"],
      ["Medium", 500, "normal"],
      ["MediumItalic", 500, "italic"],
      ["SemiBold", 600, "normal"],
      ["SemiBoldItalic", 600, "italic"],
      ["Bold", 700, "normal"],
      ["BoldItalic", 700, "italic"],
    ] as const)
      faces.push({
        family: "SF Pro Text",
        weight,
        style,
        file: path.join(interDir, `Inter-${name}.otf`),
      });
  // JetBrains Mono itself, or its Nerd Font build (the same letters).
  const mono = [
    "/usr/share/fonts/TTF",
    "/usr/share/fonts/truetype/jetbrains-mono",
    "/usr/share/fonts/truetype",
  ]
    .flatMap((dir) =>
      ["JetBrainsMono", "JetBrainsMonoNerdFont"].map((prefix) =>
        path.join(dir, prefix),
      ),
    )
    .find((prefix) => existsSync(`${prefix}-Regular.ttf`));
  if (mono)
    for (const [name, weight, style] of [
      ["Regular", 400, "normal"],
      ["Italic", 400, "italic"],
      ["Bold", 700, "normal"],
      ["BoldItalic", 700, "italic"],
    ] as const)
      faces.push({
        family: "JetBrains Mono",
        weight,
        style,
        file: `${mono}-${name}.ttf`,
      });
  return faces.filter((face) => existsSync(face.file));
}
const FONT_FACES = standInFonts();

/** The Chinese and Japanese faces, one region each. Noto Sans CJK comes as
 *  a collection (.ttc) of every region's face, and Chromium on Linux draws
 *  the first face whichever region the stack names: Traditional Chinese
 *  came out with Simplified punctuation at the bottom left of its square,
 *  where Taiwan centres it. SHOTS_CJK_FONT_DIR (default
 *  ../assets/fonts/noto-cjk-faces beside the main checkout) holds the
 *  faces split out of the collections, one file each, served under the
 *  name the app's stack gives them:
 *    python -m venv v && v/bin/pip install fonttools && v/bin/python -c '
 *    from fontTools.ttLib import TTCollection
 *    for w in "Regular","Medium","Bold":
 *      for f in TTCollection(f"/usr/share/fonts/noto-cjk/NotoSansCJK-{w}.ttc").fonts:
 *        r = f["name"].getDebugName(1)[14:16]
 *        if r in ("SC","TC","JP"): f.save(f"NotoSansCJK{r.lower()}-{w}.otf")'
 *  The same face also draws the curly quotes, the ellipsis and the dash in
 *  the UI's Latin face, as a Chinese Mac draws them: full width, the
 *  ellipsis centred, instead of narrow Latin quotes and six low dots. */
const CJK_REGION: Record<string, { family: string; tag: string }> = {
  zh: { family: "Noto Sans CJK SC", tag: "sc" },
  "zh-hant": { family: "Noto Sans CJK TC", tag: "tc" },
  ja: { family: "Noto Sans CJK JP", tag: "jp" },
};
function cjkFaceDir(): string {
  if (process.env.SHOTS_CJK_FONT_DIR)
    return path.resolve(process.env.SHOTS_CJK_FONT_DIR);
  return path.resolve(CHECKOUT, "..", "assets", "fonts", "noto-cjk-faces");
}
function fontFacesFor(lang: string): StandInFont[] {
  const region = CJK_REGION[lang];
  if (!region) return FONT_FACES;
  const dir = cjkFaceDir();
  const file = (weight: string) =>
    path.join(dir, `NotoSansCJK${region.tag}-${weight}.otf`);
  const weights = [
    [400, "Regular"],
    [500, "Medium"],
    [600, "Bold"],
    [700, "Bold"],
  ] as const;
  const faces: StandInFont[] = [];
  for (const [weight, name] of weights) {
    if (weight !== 600)
      faces.push({
        family: region.family,
        weight,
        style: "normal",
        file: file(name),
      });
    faces.push({
      family: "SF Pro Text",
      weight,
      style: "normal",
      file: file(name),
      unicodeRange: "U+2014, U+2018-2019, U+201C-201D, U+2026",
    });
  }
  const found = faces.filter((face) => existsSync(face.file));
  if (found.length < faces.length)
    throw new Error(
      `${lang}: no ${region.family} faces in ${dir} (see SHOTS_CJK_FONT_DIR)`,
    );
  // After the stand-ins: of two faces for the same characters, the later
  // one draws them.
  return [...FONT_FACES, ...found];
}

/** A Mac: the app leaves the top-left corner of its title row to the
 *  traffic lights (see .window-bar in App.css), and names Cmd in its
 *  shortcuts. */
const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The provider catalog as Rust serves it (list_providers), read from
 *  catalog.rs: the dev shim answers null, and the frontend's fallback
 *  catalog names only three providers. */
function providerCatalog() {
  const source = readFileSync("src-tauri/src/ai/catalog.rs", "utf8");
  const start = source.indexOf("pub const PROVIDER_CATALOG");
  const table = source.slice(start, source.indexOf("\n];", start));
  const entries = table.split("ProviderCatalogEntry {").slice(1);
  const text = (block: string, field: string) =>
    block.match(new RegExp(`\\b${field}: "([^"]*)"`))?.[1] ?? null;
  const optional = (block: string, field: string) =>
    block.match(new RegExp(`\\b${field}: Some\\("([^"]*)"\\)`))?.[1] ?? null;
  const flag = (block: string, field: string) =>
    new RegExp(`\\b${field}: true`).test(block);
  const list = (block: string, field: string) =>
    (
      (
        block.match(new RegExp(`\\b${field}: &\\[([^\\]]*)\\]`))?.[1] ?? ""
      ).match(/"[^"]*"/g) ?? []
    ).map((quoted) => quoted.slice(1, -1));
  const catalog = entries.map((block) => ({
    id: text(block, "id"),
    label: text(block, "label"),
    dialect: text(block, "dialect"),
    auth: list(block, "auth"),
    baseUrl: optional(block, "base_url"),
    defaultModel: optional(block, "default_model"),
    agentDefaultModel: optional(block, "agent_default_model"),
    keyOptional: flag(block, "key_optional"),
    supportsVision: flag(block, "supports_vision"),
    modelsListable: flag(block, "models_listable"),
    knownModels: list(block, "known_models"),
  }));
  if (catalog.length < 3 || catalog.some((entry) => !entry.id || !entry.label))
    throw new Error("catalog.rs: PROVIDER_CATALOG no longer parses");
  return catalog;
}
const PROVIDERS = providerCatalog();

/** Answers backend commands with canned values from the first instant,
 *  before the app's startup reads them (unlike mockInvoke, which comes
 *  after). Merged with what is already there. */
async function cannedFromStart(page: Page, results: Record<string, unknown>) {
  await page.addInitScript((r) => {
    const w = window as unknown as { __devInvokeResults?: object };
    w.__devInvokeResults = { ...w.__devInvokeResults, ...r };
  }, results);
}

/** Adds canned answers to a running page. */
async function canned(page: Page, results: Record<string, unknown>) {
  await page.evaluate((r) => {
    const w = window as unknown as { __devInvokeResults?: object };
    w.__devInvokeResults = { ...w.__devInvokeResults, ...r };
  }, results);
}

interface Launch {
  lang: string;
  /** The document the window opens with, as if double-clicked. */
  file: { path: string; content: string };
  /** What load_agent_workspace answers: the project folder and its files. */
  project?: { root: string; library: string[] };
  settings?: Record<string, unknown>;
  storage?: Record<string, string>;
}

/** Opens the app on a Mac, in the language's UI, with `file` open. */
async function launch(page: Page, options: Launch) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  // The product's name, wherever the UI's strings carry it.
  await page.route(/\/src\/i18n\/[^?]*\.ts(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\bLevis\b/g, APP_NAME);
    await route.fulfill({ response, body });
  });
  // Files outside the dev server's root - KaTeX's fonts, when node_modules
  // is a link to another checkout's, as in a worktree - which Vite refuses
  // to serve; without them every formula is drawn in a fallback serif.
  await page.route(/\/@fs\/[^?]+\.(woff2?|ttf|otf)(\?.*)?$/, (route) => {
    const file = decodeURIComponent(
      new URL(route.request().url()).pathname.slice("/@fs".length),
    );
    return existsSync(file) ? route.fulfill({ path: file }) : route.continue();
  });
  const fontFaces = fontFacesFor(options.lang);
  if (fontFaces.length > 0) {
    await page.route("**/__shots/font/*", (route) => {
      const index = Number(
        new URL(route.request().url()).pathname.split("/").pop(),
      );
      return route.fulfill({ path: fontFaces[index].file });
    });
    await page.addInitScript((faces) => {
      const style = document.createElement("style");
      style.textContent = faces
        .map(
          (face, index) =>
            `@font-face { font-family: "${face.family}"; src: url("/__shots/font/${index}"); font-weight: ${face.weight}; font-style: ${face.style};${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ""} font-display: block; }`,
        )
        .join("\n");
      const add = () => {
        if (!document.documentElement) return false;
        document.documentElement.appendChild(style);
        return true;
      };
      if (!add())
        new MutationObserver((_, observer) => {
          if (add()) observer.disconnect();
        }).observe(document, { childList: true });
    }, fontFaces);
  }
  const project = options.project;
  await cannedFromStart(page, {
    take_pending_open_path: options.file.path,
    read_text_file: options.file.content,
    file_mtime_ms: 1_760_000_000_000,
    // The canned dev-shim issue would underline every first letter.
    ai_grammar_check: [],
    list_providers: PROVIDERS,
    claude_auth_status: { configured: true },
    load_agent_workspace: project && {
      instructions: [],
      project_instructions: null,
      skills: [],
      root: project.root,
      style: "# Style profile\n\n- Plain words, short sentences.",
      library: project.library.map((name) => ({
        name,
        aliases: [],
        include: "detected",
        file: `.textus/library/${name}.md`,
        body: "",
        remembered: null,
      })),
      memories: { items: [], chars: 0, cap: 4000 },
      remember: true,
      levis_project: false,
    },
  });
  await openApp(page, {
    settings: {
      language: LANGUAGES[options.lang].ui,
      theme: "light",
      themeId: "default",
      aiProvider: "anthropic",
      agentDefaultMode: "revise",
      enableCompletion: false,
      enableEditAnimation: false,
      ...options.settings,
    },
    storage: options.storage,
  });
  await expect(page.locator(".window-bar-title")).toHaveText(
    path.basename(options.file.path),
  );
  // A UI language the app doesn't have yet falls back to English
  // (normaliseSettings); the document stays in its own language.
  const ui = LANGUAGES[options.lang].ui;
  const shown = await page.evaluate(() => document.documentElement.lang);
  if (!shown.toLowerCase().startsWith(ui.toLowerCase().slice(0, 2)))
    test.info().annotations.push({
      type: "ui",
      description: `English UI: the app has no "${ui}" UI yet`,
    });
  // The traffic lights macOS draws over the title row, where the app leaves
  // room for them: 12px, 8px apart, centred in the 28px row. Gone in zen
  // mode, which is full screen.
  await page.evaluate(() => {
    const lights = document.createElement("div");
    lights.className = "shots-traffic-lights";
    lights.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++)
      lights.appendChild(document.createElement("span"));
    document.body.appendChild(lights);
  });
  await page.addStyleTag({
    content: `
      .shots-traffic-lights { position: fixed; top: 8px; left: 8px; z-index: 2147483647; display: flex; gap: 8px; pointer-events: none; }
      .shots-traffic-lights span { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.18); }
      .shots-traffic-lights span:nth-child(1) { background: #ff5f57; }
      .shots-traffic-lights span:nth-child(2) { background: #febc2e; }
      .shots-traffic-lights span:nth-child(3) { background: #28c840; }
      .zen .shots-traffic-lights { display: none; }
    `,
  });
  // Korean is broken between words, at the spaces, not between any two
  // syllables. The app does that for its own UI only (App.css leaves the
  // document out, since keep-all would stop Chinese or Japanese text in a
  // Korean UI from breaking); these documents are all Korean.
  if (options.lang === "ko")
    await page.addStyleTag({
      content: `
        .editor-content, .source-view { word-break: keep-all !important; overflow-wrap: break-word; }
      `,
    });
}

async function emit(page: Page, event: string, payload?: unknown) {
  await page.evaluate(
    ([name, data]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, data),
    [event, payload] as const,
  );
}

/** Puts the caret right after `words` (plain text in the document; its
 *  first occurrence, or its last), where no Markdown mark is revealed: a
 *  document opens with the caret on its title, which then shows its "#". */
async function caretAfter(page: Page, words: string, last = false) {
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.focus();
  const placed = await editor.evaluate(
    (root, { text, last }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let found: { node: Node; at: number } | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = last
          ? node.textContent!.lastIndexOf(text)
          : node.textContent!.indexOf(text);
        if (at < 0) continue;
        found = { node, at };
        if (!last) break;
      }
      if (!found) return false;
      const range = document.createRange();
      range.setStart(found.node, found.at + text.length);
      range.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return true;
    },
    { text: words, last },
  );
  expect(placed, `"${words}" is not in the document`).toBe(true);
  // The editor takes the caret up on the next selectionchange.
  await page.waitForTimeout(200);
}

/** The end of the document's last top-level paragraph. */
async function caretAtEnd(page: Page) {
  const text = await page
    .locator('[data-active-tab="true"] .ProseMirror > p')
    .last()
    .innerText();
  await caretAfter(page, text.trim().slice(-12), true);
}

/** Downscales a PNG and encodes it as WebP, in the browser - no image
 *  tooling needed beyond Playwright's own Chromium. */
async function toWebp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(
      async ({ data, width, quality }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const source = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const height = Math.round((source.height * width) / source.width);
        const scaled = await createImageBitmap(source, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "high",
        });
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d")!.drawImage(scaled, 0, 0);
        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality,
        });
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return url.slice(url.indexOf(",") + 1);
      },
      {
        data: png.toString("base64"),
        width: WEBP_WIDTH,
        quality: WEBP_QUALITY,
      },
    );
    return Buffer.from(base64, "base64");
  } finally {
    await page.close();
  }
}

/** Takes the shot once nothing is still settling, and writes it as PNG and
 *  WebP. */
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
  if (APP_NAME !== "Levis") {
    const onScreen = await page.evaluate(() =>
      [
        document.body.innerText,
        ...Array.from(document.querySelectorAll("[placeholder]"), (el) =>
          el.getAttribute("placeholder"),
        ),
      ].join("\n"),
    );
    expect(onScreen, "the old product name is on screen").not.toMatch(
      /\bLevis\b/,
    );
  }
  const dir = path.join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  const png = await page.screenshot();
  writeFileSync(path.join(dir, `${name}.png`), png);
  writeFileSync(path.join(dir, `${name}.webp`), await toWebp(browser, png));
}

const fileIn = (folder: string, name: string) =>
  `/Users/me/Documents/${folder}/${name}.md`;

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
          "levis-agent-panel-open": "1",
          ...(s.panelWidth
            ? { "levis-agent-panel-width": String(s.panelWidth) }
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
      // Into the formula, as a click on it does: its source opens for
      // editing, and the live preview follows the caret.
      await page.locator(".milkdown .math-block-rendered").click();
      // At its end, as when typing it: the preview opens under the caret,
      // clear of the text below (in the middle of the formula, it covered
      // the next line's).
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
      });
      const doc = page.locator('[data-active-tab="true"] .milkdown');
      await expect(doc.locator("blockquote.md-alert")).toHaveCount(1);
      await expect(doc.locator('li[data-item-type="task"]')).toHaveCount(2);
      await expect(doc.locator("hr")).toHaveCount(1);
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
        .locator(".settings-nav-item", { hasText: `${APP_NAME} AI` })
        .click();
      await page.locator(".provider-picker .combobox-trigger").click();
      await expect(page.locator(".combobox-option")).toHaveCount(
        PROVIDERS.length,
      );
      await shoot(page, browser, lang, "settings");
    });
  });
}
