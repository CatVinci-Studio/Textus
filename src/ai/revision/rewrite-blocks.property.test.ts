// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { cachedDocument } from "../doc-markdown";
import { placeProposals } from "./pending-place";
import { diffSentences, splitUnits } from "./unit-diff";
import { formKey, wholeBlockKind } from "./markdown-forms";

/** Random documents rewritten whole, as a translation is. The pieces must
 *  join back, each be found in the document, and kept blocks stay apart. */

const RUNS = 300;

/** A small seeded generator (mulberry32): a failure names its seed. */
function random(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)],
  };
}

const SENTENCES = [
  "小满撑开伞，仔细看过伞面和竹骨。",
  "雨停了，她把伞挂在门后。",
  "夜里，她找到一枚**白色**纽扣。",
  "她查了[伞铺地图](https://example.com/map)。",
  "运行 `rain()` 就好。",
  "面积是 $a^2$ 平方米。",
];

/** One block of prose: its original and its rewrite. */
function prose(r: ReturnType<typeof random>, n: number): [string, string] {
  const count = 1 + Math.floor(r.next() * 2);
  const zh = Array.from({ length: count }, () => r.pick(SENTENCES)).join("");
  const en = Array.from(
    { length: count },
    (_, k) => `Line ${n}.${k} of the story.`,
  ).join(" ");
  switch (r.pick(["p", "p", "h", "list", "quote"] as const)) {
    case "h":
      return [`## 第${n}节`, `## Part ${n}`];
    case "list":
      return [`- ${zh}\n- 第二项`, `- ${en}\n- Item two`];
    case "quote":
      return [`> ${zh}`, `> ${en}`];
    default:
      return [zh, en];
  }
}

/** One whole block: its original, and a changed one of the same kind. */
const BLOCKS: [string, string][] = [
  ["![一把旧伞](assets/a.png)", "![一把旧伞](assets/a.png)"],
  [
    "| 名字 | 数量 |\n| --- | --- |\n| 伞 | 1 |",
    "| Name | Count |\n| --- | --- |\n| Umbrella | 1 |",
  ],
  ["```js\nconst rain = 1;\n```", "```js\nconst rain = 2;\n```"],
  ["$$\na+b\n$$", "$$\na-b\n$$"],
  ["***", "***"],
  [
    "<details><summary>注</summary>伞是旧的。</details>",
    "<details><summary>Note</summary>The umbrella is old.</details>",
  ],
];

interface Rewrite {
  doc: string;
  text: string;
  /** Kinds and order of whole blocks the same on both sides. */
  sameBlocks: boolean;
}

function rewrite(seed: number): Rewrite {
  const r = random(seed);
  const parts = 2 + Math.floor(r.next() * 5);
  const doc: string[] = [];
  const text: string[] = [];
  let sameBlocks = true;
  for (let n = 0; n < parts; n++) {
    if (r.next() < 0.55 || n === 0) {
      const [zh, en] = prose(r, n);
      doc.push(zh);
      text.push(en);
      continue;
    }
    const [original, changed] = r.pick(BLOCKS);
    const fate = r.next();
    if (fate < 0.45) {
      doc.push(original);
      text.push(original);
    } else if (fate < 0.8) {
      doc.push(original);
      text.push(changed);
    } else if (fate < 0.9 && !original.startsWith("![")) {
      // Dropped (a picture never is: the backend puts it back).
      doc.push(original);
      sameBlocks = false;
    } else {
      text.push(changed);
      sameBlocks = false;
    }
  }
  // Every document ends in prose, as the rewrite of it does.
  doc.push("全文完。");
  text.push("The end.");
  return { doc: doc.join("\n\n"), text: text.join("\n\n"), sameBlocks };
}

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

describe("whole rewrites of documents put together at random", () => {
  it(`hold their rules over ${RUNS} documents`, async () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const { doc, text, sameBlocks } = rewrite(seed);
      const editor = await createTestEditor(doc);
      editors.push(editor);
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // The document as the model is shown it, rewritten whole: its
        // first block to its last.
        const { markdown, blocks } = cachedDocument(ctx, view.state.doc);
        const anchor = markdown.trim();
        const run = { block: blocks[0].id, lastBlock: blocks.at(-1)!.id };
        const label = `seed ${seed}:\n${anchor}\n---\n${text}`;

        expect(splitUnits(anchor).join(""), label).toBe(anchor);
        expect(splitUnits(text).join(""), label).toBe(text);
        const hunks = diffSentences(anchor, text);
        // Joined back, each side reads as written (a kept table keeps the
        // document's padding, not the rewrite's).
        const side = (k: "before" | "after") =>
          hunks.map((h) => (h.kind === "same" ? h.text : h[k])).join("");
        const forms = (t: string) => splitUnits(t).map(formKey);
        expect(forms(side("before")), label).toEqual(forms(anchor));
        expect(forms(side("after")), label).toEqual(forms(text));

        if (sameBlocks)
          for (const h of hunks)
            if (h.kind === "change") {
              const whole = [h.before, h.after].filter((s) => s.trim());
              expect(
                whole.every((s) => wholeBlockKind(s) !== null) ||
                  whole.every((s) => wholeBlockKind(s) === null),
                `${label}\nmixed: ${JSON.stringify(h)}`,
              ).toBe(true);
            }

        const { placed } = placeProposals(
          ctx,
          view.state,
          [
            {
              callId: `c${seed}`,
              proposal: { action: "replace", ...run, anchor, text },
            },
          ],
          null,
        );
        expect(placed, label).toHaveLength(1);
        expect(placed[0].sentences, label).toBeDefined();
      });
      await editor.destroy();
      editors.pop();
    }
  }, 120_000);
});
