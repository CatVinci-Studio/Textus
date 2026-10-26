// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  blockSummary,
  formKey,
  matchableMarkdown,
  wholeBlockKind,
} from "./markdown-forms";

// Blocks are read by the editor's parser, which an editor registers as it
// starts.
let reader: Editor | null = null;
beforeAll(async () => {
  reader = await createTestEditor("");
});
afterAll(() => reader?.destroy());

const NAMES = {
  picture: "Picture",
  table: "Table",
  code: "Code block",
  math: "Formula",
  other: "Block",
};

describe("wholeBlockKind", () => {
  it("names the blocks a rewrite changes whole", () => {
    expect(wholeBlockKind("![An umbrella](a.png)")).toBe("picture");
    expect(wholeBlockKind('<img src="a.png" width="200">')).toBe("picture");
    expect(wholeBlockKind("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("table");
    expect(wholeBlockKind("```js\nconst a = 1;\n```")).toBe("code");
    expect(wholeBlockKind("$$\na+b\n$$")).toBe("math");
    expect(wholeBlockKind("[^1]: A note.")).toBe("footnote");
    expect(wholeBlockKind("[m]: https://example.com")).toBe("definition");
    expect(wholeBlockKind("***")).toBe("rule");
    expect(wholeBlockKind("<details><summary>s</summary>x</details>")).toBe(
      "html",
    );
  });

  it("leaves prose to be compared by its sentences", () => {
    for (const prose of [
      "A paragraph.",
      "## A heading",
      "- a list\n- of two",
      "> a quote",
      "A line with ![a picture](a.png) in it.",
      "<b>bold</b> words",
    ])
      expect(wholeBlockKind(prose), prose).toBeNull();
  });
});

describe("formKey", () => {
  it("is the same for one thing written two ways", () => {
    expect(formKey("See <https://example.com>.")).toBe(
      formKey("See https://example.com."),
    );
    expect(formKey("***")).toBe(formKey("- - -"));
    expect(formKey("| 名字 | 数量 |\n| ---- | ---- |\n| 伞   | 1    |")).toBe(
      formKey("|名字|数量|\n|---|---|\n|伞|1|"),
    );
  });

  it("forgets escapes on purpose: the editor writes them, a model doesn't", () => {
    expect(formKey("2 \\* 3")).toBe(formKey("2 * 3"));
  });

  it("tells different words apart", () => {
    expect(formKey("| a |\n| - |\n| 1 |")).not.toBe(
      formKey("| a |\n| - |\n| 2 |"),
    );
  });
});

describe("matchableMarkdown", () => {
  it("is what the document shows of a footnote mark or a reference link", () => {
    expect(matchableMarkdown("The umbrella was hers.[^1]")).toBe(
      "The umbrella was hers.",
    );
    expect(matchableMarkdown("See the [map][m].")).toBe("See the map.");
    expect(matchableMarkdown("[^1]: Kept.")).toBe("[^1]: Kept.");
  });
});

describe("blockSummary", () => {
  it("says what a whole block is", () => {
    expect(blockSummary("![An umbrella](a.png)", NAMES)).toBe(
      "Picture: An umbrella",
    );
    expect(blockSummary("| a |\n| - |", NAMES)).toBe("Table");
    expect(blockSummary("[^1]: A note.", NAMES)).toBe("[^1] A note.");
    expect(blockSummary("A sentence.", NAMES)).toBeNull();
  });
});
