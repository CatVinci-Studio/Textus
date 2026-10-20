import { describe, expect, it } from "vitest";
import { countWords } from "./word-count";

describe("countWords", () => {
  it("counts English by words", () => {
    expect(countWords("To be, or not to be.").words).toBe(6);
  });

  it("counts every Chinese character, as 字数 does", () => {
    expect(countWords("红楼梦，第三回。").words).toBe(6);
  });

  it("counts Japanese kana and kanji one by one", () => {
    expect(countWords("吾輩は猫である").words).toBe(7);
  });

  it("counts Korean by its spaced words", () => {
    expect(countWords("메밀꽃 필 무렵").words).toBe(3);
  });

  it("adds Latin words inside Chinese text as one each", () => {
    expect(countWords("聊天都在codex上面").words).toBe(7);
  });

  it("leaves fenced code out", () => {
    expect(countWords("一二\n```\nlet x = 1;\n```\n三").words).toBe(3);
  });

  it("counts a document as the sum of its paragraphs, edited or not", () => {
    const doc = "Two words.\n\n红楼梦\n\n```\ncode\n```\n\nthree more words";
    expect(countWords(doc).words).toBe(2 + 3 + 3);
    expect(countWords(doc.replace("Two", "Now two")).words).toBe(3 + 3 + 3);
  });
});
