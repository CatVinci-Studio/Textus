import { describe, expect, it } from "vitest";
import { matchLanguages } from "./code-language-picker";

const LANGS = ["", "javascript", "css", "scss", "json", "yaml"];

describe("matchLanguages", () => {
  it("offers every language before anything is typed", () => {
    expect(matchLanguages(LANGS, " ")).toEqual(LANGS);
  });

  it("puts the languages that start with what was typed first", () => {
    expect(matchLanguages(LANGS, "sc")).toEqual(["scss", "javascript", "sc"]);
    expect(matchLanguages(LANGS, "plain text")).toEqual([""]);
  });

  it("offers a language the menu lacks as it was typed", () => {
    expect(matchLanguages(LANGS, "mermaid")).toEqual(["mermaid"]);
    expect(matchLanguages(LANGS, "jso")).toEqual(["json", "jso"]);
    expect(matchLanguages(LANGS, "json")).toEqual(["json"]);
  });
});
