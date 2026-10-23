import { describe, expect, it } from "vitest";
import { changeGlimpse } from "./change-glimpse";

describe("changeGlimpse", () => {
  it("shows a changed comma with a little of the text either side", () => {
    expect(
      changeGlimpse(
        "从南湘之二妃，携汉滨之游女。",
        "从南湘之二妃；携汉滨之游女。",
      ),
    ).toEqual({
      lead: "从南湘之二妃",
      removed: "，",
      added: "；",
      tail: "携汉滨之游女",
      cutLead: false,
      cutTail: true,
      partial: true,
    });
  });

  it("cuts long context short on both sides", () => {
    const g = changeGlimpse(
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox leaps over the lazy dog.",
    );
    expect(g).toMatchObject({
      lead: "n fox ",
      removed: "jum",
      added: "lea",
      tail: "ps ove",
      cutLead: true,
      cutTail: true,
    });
  });

  it("shows an addition, a deletion and a whole new sentence", () => {
    expect(changeGlimpse("Hello world", "Hello, world")).toMatchObject({
      removed: "",
      added: ",",
    });
    expect(changeGlimpse("Gone.", "")).toMatchObject({
      lead: "",
      removed: "Gone.",
      added: "",
      tail: "",
    });
    expect(changeGlimpse("Old one.", "New two!")).toMatchObject({
      removed: "Old one.",
      added: "New two!",
      partial: false,
    });
  });

  it("doesn't split an emoji", () => {
    expect(changeGlimpse("a 😀 b", "a 😃 b")).toMatchObject({
      removed: "😀",
      added: "😃",
    });
  });
});
