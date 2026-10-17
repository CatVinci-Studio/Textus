import { describe, expect, it } from "vitest";
import { LANGS } from "../../i18n/langs";
import { scriptedReply } from "./diary-replies";

describe("scriptedReply", () => {
  it("answers in the reader's own language", () => {
    expect(scriptedReply("zh", "今晚继续写吗")).toMatch(/[一-鿿]/);
    expect(scriptedReply("ja", "今晚")).toMatch(/[぀-ヿ]/);
    expect(scriptedReply("ru", "сегодня")).toMatch(/[Ѐ-ӿ]/);
    expect(scriptedReply("en", "tonight")).toMatch(/[a-z]/i);
  });

  it("has an aside in every language the app ships", () => {
    for (const lang of LANGS) {
      const reply = scriptedReply(lang, "a line someone wrote");
      expect(reply.length, lang).toBeGreaterThan(0);
      expect(reply.trim(), lang).toBe(reply);
    }
  });

  it("is not the same sentence under every language name", () => {
    // Guards against a locale file left as an English copy: the reply is
    // the whole point of the fallback, so it has to be a real translation.
    const replies = LANGS.map((lang) => scriptedReply(lang, "the same line"));
    expect(new Set(replies).size).toBeGreaterThan(LANGS.length - 2);
  });

  it("falls back to English for a language the app does not ship", () => {
    expect(scriptedReply("xx", "a line")).toBe(scriptedReply("en", "a line"));
  });

  it("gives the same line the same answer every time", () => {
    // The page has a temper, not a slot machine: the same line must not
    // contradict itself between two turns.
    for (let i = 0; i < 5; i++) {
      expect(scriptedReply("en", "the same line")).toBe(
        scriptedReply("en", "the same line"),
      );
      expect(scriptedReply("zh", "同样的一行")).toBe(
        scriptedReply("zh", "同样的一行"),
      );
    }
  });

  it("does not answer every line with one aside", () => {
    const lines = [
      "Should I keep writing tonight?",
      "Rest first. Clear heads beat stubborn half-lights.",
      "The margin is too narrow.",
      "Ink dries faster than doubt.",
      "Nothing written at night is wasted.",
      "I am tired.",
      "Again, tomorrow.",
    ];
    expect(
      new Set(lines.map((line) => scriptedReply("en", line))).size,
    ).toBeGreaterThan(3);
  });

  it("answers an empty line without throwing", () => {
    expect(scriptedReply("en", "").length).toBeGreaterThan(0);
  });
});

describe("everyday diary atmosphere", () => {
  it("offers practical rest with a trace of the Echo Clock", () => {
    expect(scriptedReply("zh", "今天好累，想休息")).toContain("回声钟");
    expect(scriptedReply("zh", "今天好累，想休息")).toContain("放下");
  });
  it("brings writing advice and loneliness into the same world", () => {
    expect(scriptedReply("zh", "写不出来，没有灵感")).toContain("书廊");
    expect(scriptedReply("zh", "有点孤独")).toContain("守页人");
    expect(scriptedReply("en", "I am tired")).toContain("Echo Clock");
  });
});
