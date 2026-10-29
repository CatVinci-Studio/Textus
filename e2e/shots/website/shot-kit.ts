/**
 * What the website's and the README's screenshots share: each language's
 * sample texts, and a Mac-like window of the app opened on one of them.
 * Env: LANGS, SAMPLES_JSON, SHOTS_FONT_DIR, SHOTS_CJK_FONT_DIR.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openApp } from "../../helpers";
import { pluginsAtStart, type PluginsAtStart } from "../../plugin-helpers";

/** One language's texts, all Markdown. `anchor`, `commentAnchor`,
 *  `zenFocus` and `tourCaret` are quoted verbatim from their documents. */
export interface Sample {
  /** The hero document's name: its file name (<title>.md) and H1. */
  title: string;
  /** The project folder the AI panel shows, and its library's entries. */
  folder: string;
  library: string[];
  /** The hero document: a classic passage, then a reader's note on it. */
  doc: string;
  /** What the user asks the AI panel. */
  ask: string;
  /** The passage the proposed edit replaces, and its replacement. Only the
   *  first and last sentences change, so the sentence picker has two rows. */
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
  /** The AI panel's width in the hero, wider where the labels need it to
   *  keep the proposal's buttons on one row. */
  panelWidth?: number;
  /** The notes of the plugins shot, by title (each <title>.md in the
   *  folder), linked to each other with [[title]]: the first is open. */
  notes: Record<string, string>;
  /** The [[link]] whose card is shown: its last time in the first note,
   *  in the last paragraph, so the card opens below the text. */
  previewLink: string;
}

/** Mermaid's "neutral" theme draws a mind map's first branch white on the
 *  light box; each mermaid block gets a config that makes it grey. */
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
    notes: {
      Hamlet: `# Hamlet

Prince of Denmark, called home from [[Wittenberg]] by his father's death. His uncle [[Claudius]] has taken the throne and married his mother, [[Gertrude]], within the month.

## What drives him

- [[The Ghost]]'s charge to avenge a murder he can't yet prove
- Doubt: he stages [[The Mousetrap]] to be sure
- [[Horatio]], the one friend he trusts

He plays mad at [[Elsinore]] and pushes away [[Ophelia]], and he thinks more than he acts - until there is no time left to think.
`,
      Ophelia: `# Ophelia

Daughter of [[Polonius]], sister of [[Laertes]]. She loves [[Hamlet]] and is told by her father to return his letters.

After her father's death she sings of flowers and loss, and drowns in a brook.
`,
      Claudius: `# Claudius

King of Denmark, [[Hamlet]]'s uncle. He killed his brother - now [[The Ghost]] - with poison in the ear and married [[Gertrude]]. He plots with [[Laertes]] to end it with a poisoned blade. [[The Mousetrap]] shows him his own crime.
`,
      Gertrude: `# Gertrude

Queen of Denmark, [[Hamlet]]'s mother, now [[Claudius]]'s wife. She drinks the poisoned cup meant for her son.
`,
      Polonius: `# Polonius

Lord Chamberlain, father of [[Ophelia]] and [[Laertes]]. He hides behind the arras to spy on [[Hamlet]] and is stabbed through it.
`,
      Elsinore: `# Elsinore

The castle where the play takes place, on the coast of Denmark. [[Hamlet]] and [[Horatio]] meet [[The Ghost]] on its battlements; [[Claudius]] holds court in its halls, and [[Fortinbras]] takes it at the end.
`,
      "The Mousetrap": `# The Mousetrap

The play within the play, in Act III. [[Hamlet]] has the players act out a murder like his father's and watches [[Claudius]]'s face.
`,
    },
    previewLink: "Ophelia",
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
    notes: {
      贾宝玉: `# 贾宝玉

荣国府的公子，衔着[[通灵宝玉]]出生。那块玉原是[[青埂峰]]下女娲补天剩下的一块石头。

## 身边的人

- [[林黛玉]]，前世是灵河岸上的绛珠仙草
- [[薛宝钗]]，戴着金锁，与他有“金玉良缘”之说
- [[贾母]]，最疼他的祖母

他最爱和[[林黛玉]]说话，住在[[大观园]]的怡红院，最怕的是读书做官。
`,
      林黛玉: `# 林黛玉

[[贾母]]的外孙女，自幼丧母，进京投奔荣国府。前世是绛珠仙草，受[[神瑛侍者]]浇灌之恩，下凡以一生的眼泪相还。

她住在[[大观园]]的潇湘馆，葬花、作诗，与[[贾宝玉]]最知心。
`,
      通灵宝玉: `# 通灵宝玉

[[贾宝玉]]出生时衔在口中的玉，正面刻着“莫失莫忘，仙寿恒昌”。它本是[[青埂峰]]下的顽石，由一僧一道带入红尘。
`,
      青埂峰: `# 青埂峰

大荒山无稽崖下的山峰。女娲炼石补天，单剩一块未用，弃在此峰下——后来成了[[通灵宝玉]]。[[甄士隐]]在第一回的梦里听到的，正是这段因缘。
`,
      甄士隐: `# 甄士隐

姑苏的乡宦，第一回开场的人物。他资助[[贾雨村]]进京赶考；后来家道败落，听了《好了歌》，随跛足道人出家。
`,
      贾雨村: `# 贾雨村

落魄书生，得[[甄士隐]]资助后中了进士。后来在林如海家做西席，教[[林黛玉]]读书，又随她一同进京。
`,
      大观园: `# 大观园

为元妃省亲而建的园子。省亲之后，[[贾宝玉]]、[[林黛玉]]、[[薛宝钗]]和姐妹们都搬了进去。
`,
    },
    previewLink: "林黛玉",
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
    notes: {
      吾輩: `# 吾輩

名前はまだない猫。[[苦沙弥]]先生の家に住みつき、そこに集まる人間たちを観察している。

## 家に来る人たち

- [[迷亭]]、口から出まかせばかりの美学者
- [[寒月]]、ガラス玉を磨いている理学士
- [[東風]]、新体詩を作る青年

人間の言葉はわかるが、話すことはできない。[[苦沙弥]]の書斎で居眠りをしながら、[[迷亭]]の冗談を聞いては、ひそかにあきれている。
`,
      苦沙弥: `# 苦沙弥

中学校の英語教師で、[[吾輩]]の主人。胃が弱く、書斎にこもっては昼寝ばかりしている。[[迷亭]]や[[寒月]]がよく訪ねてくる。
`,
      迷亭: `# 迷亭

[[苦沙弥]]の旧友の美学者。ほらを吹いて人をかつぐのが好きで、[[吾輩]]もたびたびあきれている。[[寒月]]の縁談にも口を出す。
`,
      寒月: `# 寒月

理学士で、[[苦沙弥]]のもとの教え子。博士論文のためにガラス玉を磨き続けている。[[金田]]家の娘、[[富子]]との縁談が持ち上がる。
`,
      金田: `# 金田

近所の実業家。妻の[[鼻子]]が、娘の[[富子]]と[[寒月]]の縁談を探りに[[苦沙弥]]の家へやって来る。
`,
    },
    previewLink: "迷亭",
  },
};

/** Site language code -> the app's UI language and the browser locale. */
export const LANGUAGES: Record<string, { ui: string; locale: string }> = {
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

export const LANGS = (process.env.LANGS ?? "en,zh,ja")
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
export const SAMPLES = loadSamples();

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
export const CHECKOUT = mainCheckout();

const WEBP_WIDTH = 1920;
const WEBP_QUALITY = 0.85;

/** Stand-ins for fonts a Mac has: Inter for San Francisco, JetBrains Mono for
 *  code. Each is used when its files are found. */
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
    // A Mac's TeX Live: its Chromium has no SF Pro for a page to name.
    ...["2026", "2025"].map(
      (year) =>
        `/usr/local/texlive/${year}/texmf-dist/fonts/opentype/public/inter`,
    ),
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
export const FONT_FACES = standInFonts();

/** The CJK faces, one file per region: from a .ttc collection, Chromium on
 *  Linux draws the first face whatever region the stack names. They also
 *  draw curly quotes and the ellipsis full width, as a Chinese Mac does. */
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

/** A Mac: the app leaves room for the traffic lights and names Cmd in its
 *  shortcuts. */
export const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The provider catalog as the backend serves it: the dev shim answers null
 *  and the frontend's fallback names only three providers. */
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
    oauthUnofficial: flag(block, "oauth_unofficial"),
    supportsVision: flag(block, "supports_vision"),
    modelsListable: flag(block, "models_listable"),
    knownModels: list(block, "known_models"),
  }));
  if (catalog.length < 3 || catalog.some((entry) => !entry.id || !entry.label))
    throw new Error("catalog.rs: PROVIDER_CATALOG no longer parses");
  return catalog;
}
export const PROVIDERS = providerCatalog();

/** Answers backend commands with canned values before the app's startup
 *  reads them. Merged with what is already there. */
async function cannedFromStart(page: Page, results: Record<string, unknown>) {
  await page.addInitScript((r) => {
    const w = window as unknown as { __devInvokeResults?: object };
    w.__devInvokeResults = { ...w.__devInvokeResults, ...r };
  }, results);
}

/** Adds canned answers to a running page. */
export async function canned(page: Page, results: Record<string, unknown>) {
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
  /** Plugins on from the start, and the files on disk: the document is
   *  then read from them. */
  plugins?: PluginsAtStart;
}

/** Opens the app on a Mac, in the language's UI, with `file` open. */
export async function launch(page: Page, options: Launch) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  // Vite refuses to serve KaTeX's fonts when node_modules is a link outside
  // its root, as in a worktree.
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
    // A plugin's frame may load fonts only from data: the small Latin faces
    // go in as data, so its text (and canvas) has them too.
    const sources = fontFaces.map((face, index) =>
      statSync(face.file).size < 1_000_000
        ? `data:font/otf;base64,${readFileSync(face.file).toString("base64")}`
        : `/__shots/font/${index}`,
    );
    await page.addInitScript(
      ([faces, sources]) => {
        const style = document.createElement("style");
        style.textContent = faces
          .map(
            (face, index) =>
              `@font-face { font-family: "${face.family}"; src: url("${sources[index]}"); font-weight: ${face.weight}; font-style: ${face.style};${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ""} font-display: block; }`,
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
      },
      [fontFaces, sources] as const,
    );
  }
  const project = options.project;
  if (options.plugins) await pluginsAtStart(page, options.plugins);
  await cannedFromStart(page, {
    take_pending_window_paths: [options.file.path],
    ...(options.plugins ? {} : { read_text_file: options.file.content }),
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
    },
  });
  await openApp(page, {
    settings: {
      language: LANGUAGES[options.lang].ui,
      theme: "light",
      themeId: "default",
      aiProvider: "anthropic",
      agentDefaultMode: "write",
      enableCompletion: false,
      enableEditAnimation: false,
      ...options.settings,
    },
    storage: options.storage,
  });
  await expect(page.locator(".window-bar-title")).toHaveText(
    path.basename(options.file.path),
  );
  // A UI language the app doesn't have falls back to English; the document
  // stays in its own language.
  const ui = LANGUAGES[options.lang].ui;
  const shown = await page.evaluate(() => document.documentElement.lang);
  if (!shown.toLowerCase().startsWith(ui.toLowerCase().slice(0, 2)))
    test.info().annotations.push({
      type: "ui",
      description: `English UI: the app has no "${ui}" UI yet`,
    });
  // The traffic lights macOS draws over the title row; gone in full-screen
  // zen mode.
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
  // Korean breaks at spaces. The app applies keep-all to its UI only, since
  // it would stop CJK text from breaking; these documents are all Korean.
  if (options.lang === "ko")
    await page.addStyleTag({
      content: `
        .editor-content, .source-view { word-break: keep-all !important; overflow-wrap: break-word; }
      `,
    });
}

export async function emit(page: Page, event: string, payload?: unknown) {
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

/** Puts the caret right after `words`, where no Markdown mark is revealed:
 *  on the title, the caret would show its "#". */
export async function caretAfter(page: Page, words: string, last = false) {
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
export async function caretAtEnd(page: Page) {
  const text = await page
    .locator('[data-active-tab="true"] .ProseMirror > p')
    .last()
    .innerText();
  await caretAfter(page, text.trim().slice(-12), true);
}

/** Downscales a PNG and encodes it as WebP in the browser, so no other image
 *  tooling is needed. */
export async function toWebp(browser: Browser, png: Buffer): Promise<Buffer> {
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

export const fileIn = (folder: string, name: string) =>
  `/Users/me/Documents/${folder}/${name}.md`;
