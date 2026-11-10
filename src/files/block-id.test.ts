import { describe, expect, it } from "vitest";
import { blockIdAt } from "./block-id";

const fixed = () => "a1b2c3";
const at = (text: string, line: number) => blockIdAt(text, line, fixed);

describe("blockIdAt", () => {
  it("gives a paragraph an id at the end of its last line, every other byte kept", () => {
    const text = "# T\r\n\r\nFirst line\r\nsecond line  \r\n\r\nNext\r\n";
    expect(at(text, 2)).toEqual({
      id: "a1b2c3",
      text: "# T\r\n\r\nFirst line\r\nsecond line ^a1b2c3  \r\n\r\nNext\r\n",
    });
  });

  it("returns the id a block already has, writing nothing", () => {
    const text = "Para ^old1\n\n- one\n- two ^x-2\n";
    expect(at(text, 0)).toEqual({ id: "old1", text });
    expect(at(text, 3)).toEqual({ id: "x-2", text });
  });

  it("reads an id on its own line after a table or code block", () => {
    const text = "| a |\n| - |\n| 1 |\n\n^tbl\n\n```js\nx\n```\n^code\n";
    expect(at(text, 1)?.id).toBe("tbl");
    expect(at(text, 7)?.id).toBe("code");
  });

  it("writes a table's, quote's or code block's id on a line of its own", () => {
    expect(at("| a |\n| - |\n| 1 |\n# Next", 0)?.text).toBe(
      "| a |\n| - |\n| 1 |\n\n^a1b2c3\n\n# Next",
    );
    expect(at("> q\r\n> r", 1)?.text).toBe("> q\r\n> r\r\n\r\n^a1b2c3");
    expect(at("```\nx\n```\n\nafter\n", 1)?.text).toBe(
      "```\nx\n```\n\n^a1b2c3\n\nafter\n",
    );
  });

  it("gives each list item its own id and leaves headings' text alone", () => {
    expect(at("- one\n- two\n", 1)?.text).toBe("- one\n- two ^a1b2c3\n");
    expect(at("## Head\n", 0)?.text).toBe("## Head ^a1b2c3\n");
  });

  it("finds no block on a blank line or in front matter", () => {
    expect(at("---\nk: v\n---\n\nText", 1)).toBeNull();
    expect(at("---\nk: v\n---\n\nText", 3)).toBeNull();
  });

  it("makes a fresh id of 6 lowercase hex characters", () => {
    expect(blockIdAt("Text", 0)?.id).toMatch(/^[0-9a-f]{6}$/);
  });
});
