import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("leaves an image's turn and width out of its title", () => {
    expect(countWords('![a](a.png "Shot {textus-rotate=90}")').words).toBe(
      countWords('![a](a.png "Shot")').words,
    );
    expect(countWords("x {textus-width=50% textus-rotate=180}").words).toBe(1);
  });

  it("leaves fenced code out", () => {
    expect(countWords("一二\n```\nlet x = 1;\n```\n三").words).toBe(3);
  });

  it("counts a document as the sum of its paragraphs, edited or not", () => {
    const doc = "Two words.\n\n红楼梦\n\n```\ncode\n```\n\nthree more words";
    expect(countWords(doc).words).toBe(2 + 3 + 3);
    expect(countWords(doc.replace("Two", "Now two")).words).toBe(3 + 3 + 3);
  });

  describe("its paragraph cache", () => {
    const segments = () => vi.spyOn(Intl.Segmenter.prototype, "segment");
    afterEach(() => vi.restoreAllMocks());
    const doc = (tag: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${tag} ${i}`).join("\n\n");

    it("keeps a document counted while another one is", () => {
      const big = doc("big", 30_000);
      countWords(big);
      countWords(doc("small", 10));
      const spy = segments();
      expect(countWords(big).words).toBe(60_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it("recounts only the edited paragraph past 50,000 paragraphs", () => {
      const long = doc("long", 60_000);
      countWords(long);
      const spy = segments();
      expect(countWords(long + " more").words).toBe(120_001);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
