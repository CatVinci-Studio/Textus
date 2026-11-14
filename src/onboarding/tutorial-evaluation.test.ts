import { describe, expect, it } from "vitest";
import { hasFormatting } from "./tutorial-evaluation";

describe("hasFormatting", () => {
  it.each(["# Title", "### Part", "- item", "* item", "1. first", "2) second"])(
    "sees %s",
    (line) => expect(hasFormatting(`plain\n${line}`)).toBe(true),
  );

  it.each(["", "plain text", "#hashtag", "- ", "1.5 litres"])(
    "not %s",
    (text) => expect(hasFormatting(text)).toBe(false),
  );
});
