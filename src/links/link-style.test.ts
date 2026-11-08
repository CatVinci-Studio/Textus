import { describe, expect, it } from "vitest";
import { folderLinkStyle, linkStyleIn } from "./link-style";
import { DEFAULT_LINK_STYLE } from "./link-resolve";

describe("how a link is written", () => {
  it("is a standard link by its path where nothing says otherwise", () => {
    expect(DEFAULT_LINK_STYLE).toEqual({ wiki: false, format: "relative" });
    expect(folderLinkStyle(null)).toBeNull();
  });

  it("is the folder's own choice, else an Obsidian vault's", () => {
    const at = (value: string) => ({ value, app: "obsidian", root: "/v" });
    expect(
      folderLinkStyle({ linkStyle: at("markdown") } as never),
    ).toMatchObject({ wiki: false });
    expect(
      folderLinkStyle({ detected: { linkStyle: at("wiki") } } as never),
    ).toEqual({ wiki: true, format: "shortest" });
  });

  it("follows the links a note already has, so a page never mixes them", () => {
    expect(linkStyleIn("See [[Nov 5]] and [[Nov 6]].")).toMatchObject({
      wiki: true,
    });
    expect(linkStyleIn("[a](a.md), [b](b.md) and [[c]]")).toMatchObject({
      wiki: false,
    });
    expect(linkStyleIn("only [the web](https://x.org)")).toBeNull();
  });
});
