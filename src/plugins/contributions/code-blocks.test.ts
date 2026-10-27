import { describe, expect, it } from "vitest";
import { parseFenceMeta } from "./code-blocks";

describe("parseFenceMeta", () => {
  it("reads key=value pairs, quoted values and bare words", () => {
    expect(
      parseFenceMeta(`height=300 title="Sales 2026" note='a b' legend`),
    ).toEqual({
      height: "300",
      title: "Sales 2026",
      note: "a b",
      legend: "true",
    });
  });

  it("is empty for no meta, and keeps the last of a key given twice", () => {
    expect(parseFenceMeta("")).toEqual({});
    expect(parseFenceMeta("  ")).toEqual({});
    expect(parseFenceMeta("h=1 h=2")).toEqual({ h: "2" });
  });

  it("keeps an empty value empty", () => {
    expect(parseFenceMeta(`title="" x=`)).toEqual({ title: "", x: "" });
  });
});
