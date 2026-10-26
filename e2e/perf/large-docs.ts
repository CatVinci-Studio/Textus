/**
 * The benchmark's large documents, generated from a fixed seed so every
 * machine and branch measures the same text without a committed fixture.
 */

export type DocLanguage = "zh" | "en";

export interface LargeDoc {
  name: string;
  markdown: string;
  /** Top-level blocks, as written (blank-line separated). */
  blocks: number;
  /** A line of the last heading, for checking the end was rendered. */
  lastHeading: string;
}

/** mulberry32: small, fast, and the same everywhere. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZH_PHRASES = [
  "城市更新不只是拆旧建新",
  "很多居民已经在这里生活了几十年",
  "他们的记忆和街道连在一起",
  "我们花了两个月的时间做访谈",
  "大多数受访者并不反对改造",
  "真正担心的是临时安置和租金上涨",
  "这项研究在三个街区进行",
  "数据来自市统计局公开的年鉴",
  "结果和我们最初的猜想并不一致",
  "下一节会讨论样本的局限",
  "每一条街都有自己的节奏",
  "早市在清晨六点开张",
  "老人们在树荫下下棋",
  "新的地铁站改变了人流的方向",
];

const EN_WORDS = (
  "the city renewal is not only about tearing down old buildings many " +
  "residents have lived here for decades and their memories are tied to " +
  "these streets we spent two months interviewing people in three " +
  "neighbourhoods most of them do not oppose the plan what worries them " +
  "is temporary housing and rising rent the data come from public " +
  "yearbooks results differ from what we first expected the next " +
  "section discusses the limits of the sample every street keeps its " +
  "own rhythm the morning market opens at six"
).split(" ");

const FORMULAS = [
  "E=mc^2",
  "a^2+b^2=c^2",
  "\\frac{1}{n}\\sum_{i=1}^{n} x_i",
  "\\int_0^1 x^2\\,dx",
  "\\alpha+\\beta=\\gamma",
  "\\sqrt{2}\\approx 1.414",
];

const BLOCK_FORMULAS = [
  "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
  "\\sum_{k=0}^{n} \\binom{n}{k} = 2^n",
  "\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}",
  "f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}",
];

const CODE_LANGS = ["js", "ts", "python", "rust", "bash", "json"];

type Kind =
  | "image"
  | "inlineMath"
  | "blockMath"
  | "table"
  | "mermaid"
  | "code"
  | "quote"
  | "alert"
  | "html"
  | "list"
  | "paragraph";

// Per 5,000 blocks; a heading comes before every 25th, on top of these.
const PER_5K: [Kind, number][] = [
  ["image", 150],
  ["inlineMath", 300],
  ["blockMath", 60],
  ["table", 40],
  ["mermaid", 15],
  ["code", 80],
  ["quote", 30],
  ["alert", 20],
  ["html", 40],
  ["list", 200],
];

class Writer {
  rand: () => number;
  lang: DocLanguage;
  constructor(rand: () => number, lang: DocLanguage) {
    this.rand = rand;
    this.lang = lang;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)];
  }

  /** A sentence of about `size` characters (Chinese) or words (English). */
  sentence(size: number): string {
    if (this.lang === "zh") {
      let text = "";
      while (text.length < size) text += this.pick(ZH_PHRASES) + "，";
      return text.slice(0, -1) + "。";
    }
    const words: string[] = [];
    for (let i = 0; i < size; i++) words.push(this.pick(EN_WORDS));
    const text = words.join(" ");
    return text[0].toUpperCase() + text.slice(1) + ".";
  }

  paragraph(): string {
    const parts = 1 + Math.floor(this.rand() * 3);
    const size = this.lang === "zh" ? 20 : 10;
    const sentences: string[] = [];
    for (let i = 0; i < parts; i++) sentences.push(this.sentence(size));
    // Some inline formatting, which the reveal plugins look at too.
    if (this.rand() < 0.3) sentences[0] = `**${sentences[0]}**`;
    if (this.rand() < 0.2) sentences.push("`inline code`");
    return sentences.join(this.lang === "zh" ? "" : " ");
  }

  block(kind: Kind, n: number): string {
    switch (kind) {
      case "image":
        return n % 2
          ? `![picture ${n}](images/pic-${n % 12}.png)`
          : `<img src="images/pic-${n % 12}.png" width="320" alt="picture ${n}">`;
      case "inlineMath":
        // Each formula its own, as in a real paper: the same source would
        // come from the editor's render cache.
        return `${this.sentence(12)} $${this.pick(FORMULAS)} + k_{${n}}$ ${this.sentence(10)}`;
      case "blockMath":
        return `$$\n${this.pick(BLOCK_FORMULAS)} \\quad (${n})\n$$`;
      case "table": {
        const rows = ["| 序号 | 名称 | 数量 | 备注 |", "|---|---|---|---|"];
        for (let r = 0; r < 5; r++)
          rows.push(`| ${r + 1} | ${this.sentence(4)} | ${r * 7} | ok |`);
        return rows.join("\n");
      }
      case "mermaid":
        return [
          "```mermaid",
          "flowchart LR",
          `  A${n}[Start] --> B${n}{Check}`,
          `  B${n} -->|yes| C${n}[Done]`,
          `  B${n} -->|no| D${n}[Retry]`,
          "```",
        ].join("\n");
      case "code": {
        const lang = this.pick(CODE_LANGS);
        const lines: string[] = [];
        for (let l = 0; l < 6; l++)
          lines.push(
            `const value${l} = compute(${l}, "${this.pick(EN_WORDS)}");`,
          );
        return `\`\`\`${lang}\n${lines.join("\n")}\n\`\`\``;
      }
      case "quote":
        return `> ${this.sentence(20)}`;
      case "alert":
        return `> [!${this.pick(["NOTE", "TIP", "WARNING"])}]\n> ${this.sentence(16)}`;
      case "html":
        return n % 2
          ? `${this.sentence(8)} <kbd>Ctrl</kbd> <b>${this.sentence(4)}</b> ${this.sentence(6)}`
          : `<div align="center">${this.sentence(10)}</div>`;
      case "list":
        return [1, 2, 3].map(() => `- ${this.sentence(10)}`).join("\n");
      case "paragraph":
        return this.paragraph();
    }
  }
}

/** A mixed document of about `blocks` top-level blocks. */
export function mixedDoc(lang: DocLanguage, blocks: number): LargeDoc {
  const rand = random(lang === "zh" ? 50_000 : 50_001);
  const w = new Writer(rand, lang);
  const kinds: Kind[] = [];
  for (const [kind, per5k] of PER_5K)
    for (let i = 0; i < Math.round((per5k * blocks) / 5000); i++)
      kinds.push(kind);
  while (kinds.length < blocks) kinds.push("paragraph");
  // Fisher-Yates, seeded: the specials spread through the document.
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const out: string[] = [];
  let lastHeading = "";
  kinds.forEach((kind, n) => {
    if (n % 25 === 0) {
      const level = n % 100 === 0 ? 1 : 2;
      const k = n / 25 + 1;
      lastHeading = lang === "zh" ? `第${k}节` : `Section ${k}`;
      out.push(`${"#".repeat(level)} ${lastHeading}`);
    }
    out.push(w.block(kind, n));
  });
  return {
    name: `${lang}-${blocks >= 1000 ? `${blocks / 1000}k` : blocks}`,
    markdown: out.join("\n\n") + "\n",
    blocks: out.length,
    lastHeading,
  };
}

/** About `chars` characters of plain Chinese paragraphs, headed every 40. */
export function plainDoc(chars: number): LargeDoc {
  const w = new Writer(random(200_000), "zh");
  const out: string[] = [];
  let size = 0;
  let lastHeading = "";
  while (size < chars) {
    if (out.length % 40 === 0) {
      lastHeading = `第${out.length / 40 + 1}章`;
      out.push(`## ${lastHeading}`);
    }
    const p = w.paragraph();
    out.push(p);
    size += p.length;
  }
  return {
    name: `plain-${Math.round(chars / 1000)}k`,
    markdown: out.join("\n\n") + "\n",
    blocks: out.length,
    lastHeading,
  };
}
