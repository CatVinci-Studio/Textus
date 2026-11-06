import { afterEach, expect, it } from "vitest";
import { forgetWillSave, runWillSave, setWillSave } from "./will-save";
import { applyBlockEdits, mergeWholeText, textBlocks } from "./save-blocks";

const DOC = [
  "---",
  "title: a",
  "---",
  "",
  "# Title",
  "",
  "some  text",
  "",
  "```js",
  "let  x = 1;",
  "```",
  "",
  "$$",
  "a  +  b",
  "$$",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "[d]: https://example.com",
  "",
].join("\r\n");

const squeeze = (text: string) => text.replace(/  +/g, " ");

afterEach(() => {
  for (const id of ["a.one", "b.two", "c.flip"]) forgetWillSave(id);
});

it("reads the blocks of a document with their kinds and places", () => {
  const blocks = textBlocks(DOC);
  expect(blocks.map((b) => b.kind)).toEqual([
    "other",
    "heading",
    "paragraph",
    "code",
    "math",
    "table",
    "definition",
  ]);
  for (const block of blocks)
    expect(DOC.slice(block.from, block.to)).toBe(block.markdown);
});

it("writes back a whole new text only where a plugin may change it, keeping CRLF", () => {
  const saved = mergeWholeText(DOC, squeeze(DOC).replace(/\r\n/g, "\n"));
  expect(saved).toBe(DOC.replace("some  text", "some text"));
});

it("writes a block edit in its block and drops one in code", () => {
  const blocks = textBlocks(DOC);
  const why: string[] = [];
  const saved = applyBlockEdits(
    DOC,
    blocks,
    [
      { block: blocks[2].id, markdown: "new\ntext" },
      { block: blocks[3].id, markdown: "```js\nx\n```" },
    ],
    (w) => why.push(w),
  );
  expect(saved).toBe(DOC.replace("some  text", "new\r\ntext"));
  expect(why).toHaveLength(1);
});

it("asks plugins in id order, each on the text the one before left", async () => {
  const seen: string[] = [];
  setWillSave("b.two", true, async ({ text }) => {
    seen.push("b");
    return text.replace("# Title\r\n", "# Title!\r\n");
  });
  setWillSave("a.one", true, async ({ text, blocks, trigger }) => {
    seen.push("a");
    expect(trigger).toBe("auto");
    expect(blocks.length).toBe(7);
    return squeeze(text);
  });
  const saved = await runWillSave("/n.md", DOC, "auto");
  expect(seen).toEqual(["a", "a", "b", "b"]);
  expect(saved).toBe(
    DOC.replace("some  text", "some text").replace("# Title", "# Title!"),
  );
});

it("drops a change that changes again when run a second time", async () => {
  setWillSave("c.flip", true, async ({ text }) =>
    text.replace(/some {2,}/, (m) => `${m} `),
  );
  expect(await runWillSave("/n.md", DOC)).toBe(DOC);
});
