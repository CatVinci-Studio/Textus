import { describe, expect, it } from "vitest";
import { mayBePinyin, pinyinIndexOf, readings } from "./pinyin";

const find = (name: string, query: string) =>
  pinyinIndexOf(readings(name) ?? [], query);

describe("pinyin matching", () => {
  it("finds a name by full pinyin, initials, or both mixed", () => {
    expect(find("背诵.md", "beisong")).toBe(0);
    expect(find("背诵.md", "bs")).toBe(0);
    expect(find("背诵.md", "beis")).toBe(0);
    expect(find("背诵.md", "bsong")).toBe(0);
    expect(find("每日背诵", "bei song")).toBe(2);
    expect(find("重庆旅行", "chongqing")).toBe(0);
    expect(find("背诵.md", "bx")).toBe(-1);
    expect(find("背诵.md", "songbei")).toBe(-1);
  });

  it("leaves names without Chinese, and queries that aren't letters, alone", () => {
    expect(readings("notes.md")).toBeNull();
    expect(mayBePinyin("bs")).toBe(true);
    expect(mayBePinyin("背诵")).toBe(false);
    expect(mayBePinyin("v1.2")).toBe(false);
  });
});
