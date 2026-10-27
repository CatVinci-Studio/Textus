import { describe, expect, it } from "vitest";
import { bareUrl } from "./paste-url";

describe("bareUrl", () => {
  it("takes a lone URL, trimmed", () => {
    expect(bareUrl(" https://github.com/CatVinci-Studio/Textus/issues\n")).toBe(
      "https://github.com/CatVinci-Studio/Textus/issues",
    );
    expect(bareUrl("mailto:a@b.org")).toBe("mailto:a@b.org");
    expect(bareUrl("ftp://x.org/f")).toBe("ftp://x.org/f");
  });

  it("leaves anything else to the markdown paste", () => {
    expect(bareUrl("see https://x.org")).toBeNull();
    expect(bareUrl("https://x.org\nhttps://y.org")).toBeNull();
    expect(bareUrl("[a](https://x.org)")).toBeNull();
    expect(bareUrl("<https://x.org>")).toBeNull();
    expect(bareUrl("file:///tmp/a.png")).toBeNull();
    expect(bareUrl("javascript:alert(1)")).toBeNull();
  });
});
