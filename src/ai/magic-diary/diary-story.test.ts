import { describe, expect, it } from "vitest";
import { storyReply } from "./diary-story";
import { scriptedReply } from "./diary-replies";

describe("Textus's hidden story", () => {
  it("answers lore questions with the original story even without a model", () => {
    expect(storyReply("zh", "你是谁？", [])).toContain("Textus");
    expect(scriptedReply("zh", "薇拉来过这里吗？")).toContain("薇拉");
    expect(storyReply("zh", "这些脚印是谁的？", [])).toContain("守页人");
  });
  it("continues the last story fragment rather than restarting it", () => {
    const first = storyReply("zh", "讲讲你的故事", [])!;
    const next = storyReply("zh", "后来呢？", [
      { line: "讲讲你的故事", reply: first },
    ]);
    expect(next).not.toBe(first);
    expect(next).toContain("薇拉");
  });
  it("leaves ordinary conversation and unrelated followups to the model", () => {
    expect(storyReply("zh", "明天要准备什么？", [])).toBeNull();
    expect(
      storyReply("zh", "继续", [
        { line: "写邮件", reply: "先把主要目的写下来。" },
      ]),
    ).toBeNull();
    expect(storyReply("zh", "你好", [])).toBeNull();
  });
  it("says the story is Textus's own when asked where it comes from", () => {
    expect(storyReply("zh", "原著里真的有Textus吗？", [])).toContain("原创");
  });
  it("offers English and traditional Chinese story replies without overriding other app languages", () => {
    expect(storyReply("en", "Who are you?", [])).toContain("Textus");
    expect(storyReply("zh-Hant", "這些腳印是誰的？", [])).toContain("守頁人");
    expect(storyReply("ja", "Vela", [])).toBeNull();
  });
  it("lets a reader follow the entire tale in short fragments", () => {
    const history: { line: string; reply: string }[] = [];
    let line = "讲讲你的故事";
    const replies: string[] = [];
    for (let i = 0; i < 9; i++) {
      const reply = storyReply("zh", line, history)!;
      expect(reply).toBeTruthy();
      expect(Array.from(reply).length).toBeLessThanOrEqual(200);
      replies.push(reply);
      history.push({ line, reply });
      line = "后来呢";
    }
    expect(new Set(replies).size).toBe(9);
    expect(replies[8]).toContain("我在这里");
  });
});
