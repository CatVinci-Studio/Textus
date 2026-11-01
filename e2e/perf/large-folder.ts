/**
 * A large folder of notes for the plugin benchmark: front matter, wikilinks
 * between notes, tags, dated tasks and sections, generated from a fixed seed.
 */
import { mixedDoc, type LargeDoc } from "./large-docs";

const PHRASES = [
  "城市更新不只是拆旧建新",
  "很多居民已经在这里生活了几十年",
  "我们花了两个月的时间做访谈",
  "真正担心的是临时安置和租金上涨",
  "数据来自市统计局公开的年鉴",
  "每一条街都有自己的节奏",
  "早市在清晨六点开张",
  "新的地铁站改变了人流的方向",
];

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

export const noteTitle = (i: number) => `笔记${i}`;
const notePath = (root: string, i: number) =>
  `${root}/主题${i % 40}/${noteTitle(i)}.md`;

/** `notes` notes under `root`, in 40 folders, by path. */
export function largeFolder(
  root: string,
  notes: number,
): Record<string, string> {
  const rand = random(7_000);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const other = () => Math.floor(rand() * notes);
  const files: Record<string, string> = {};
  for (let i = 0; i < notes; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    const sentence = () =>
      Array.from({ length: 3 }, () => pick(PHRASES)).join("，") + "。";
    files[notePath(root, i)] = [
      "---",
      `tags: [主题${i % 40}, 标签${i % 30}]`,
      `date: 2026-10-${day}`,
      "---",
      `# ${noteTitle(i)}`,
      "",
      `${sentence()} 见 [[${noteTitle(other())}]] 和 [[${noteTitle(other())}]]。 #标签${i % 50}`,
      "",
      `- [ ] 回访第 ${i} 户 📅 2026-11-${day}`,
      "- [x] 整理访谈记录",
      "",
      "## 小节",
      "",
      `${sentence()}${sentence()}`,
      "",
    ].join("\n");
  }
  return files;
}

/** One small block of each kind the drawing plugins draw. */
const DRAWN = [
  "```markmap\n# 城市更新\n## 访谈\n- 居民\n- 店主\n## 数据\n- 年鉴\n```",
  '```echarts\n{ xAxis: { type: "category", data: ["一月", "二月", "三月"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [120, 200, 150] }] }\n```',
  '```chartjs\n{ type: "line", data: { labels: ["一月", "二月", "三月"], datasets: [{ label: "访谈", data: [12, 19, 30] }] } }\n```',
  "```abc\nX:1\nT:音阶\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |\n```",
  '```wavedrom\n{ signal: [{ name: "clk", wave: "p....." }, { name: "data", wave: "x.345x", data: ["a", "b", "c"] }] }\n```',
  "```function-plot\nsin(x)\nx^2 / 4 - 1\n```",
  "```timeline\n2024-03 | 初稿 | 提纲和两章\n2024-09 | 审阅 | 三位读者的意见\n2025-01 | 出版\n```",
];

/** The benchmark's largest mixed document, with the folder's kinds of links,
 *  tags and tasks among its paragraphs, and ten of each drawn block. */
export function largeLinkedDoc(notes: number): LargeDoc {
  const doc = mixedDoc("zh", 20000);
  const rand = random(9_000);
  const blocks = doc.markdown.trimEnd().split("\n\n");
  const out: string[] = [];
  blocks.forEach((block, i) => {
    const plain = /^[\p{Script=Han}A-Za-z]/u.test(block);
    out.push(
      plain && i % 40 === 0
        ? `${block} 参见 [[${noteTitle(Math.floor(rand() * notes))}]] #标签${i % 50}`
        : block,
    );
    if (i % 2000 === 1000) for (const block of DRAWN) out.push(block);
    if (i % 80 === 0)
      out.push(
        `- [ ] 核对第 ${i} 段 📅 2026-11-${String(1 + (i % 28)).padStart(2, "0")}`,
      );
  });
  return { ...doc, name: "zh-20k-linked", markdown: out.join("\n\n") + "\n" };
}
