import { describe, expect, it } from "vitest";
import { syntaxMatches } from "./plugin-syntax";
import {
  syntaxPattern,
  type PluginSyntax,
} from "../../plugins/contributions/syntax";

const syntax = (source: string, style: PluginSyntax["style"]) => ({
  pattern: syntaxPattern(source)!,
  style,
  tone: "accent" as const,
});

describe("a plugin's inline syntax", () => {
  it("takes only patterns that match some text", () => {
    expect(syntaxPattern("a*")).toBeNull();
    expect(syntaxPattern("(")).toBeNull();
    expect(syntaxPattern("")).toBeNull();
    expect(syntaxPattern("x", "gyi")?.flags).toBe("dgi");
  });

  it("styles its text group and hides the rest; all of it without one", () => {
    const spoiler = syntax("\\|\\|(?<text>[^|]+)\\|\\|", "spoiler");
    const todo = syntax("TODO", "highlight");
    const found = syntaxMatches("a ||b|| TODO", [spoiler, todo]);
    expect(found.map(({ from, to, shown }) => [from, to, shown])).toEqual([
      [2, 7, [4, 5]],
      [8, 12, [8, 12]],
    ]);
  });

  it("gives ruby its note, and never draws two over the same words", () => {
    const ruby = syntax("\\{(?<text>[^|}]+)\\|(?<note>[^}]+)\\}", "ruby");
    const all = syntax("\\{[^}]*\\}", "muted");
    const found = syntaxMatches("{漢字|かんじ}", [ruby, all]);
    expect(found).toHaveLength(1);
    expect(found[0].note).toBe("かんじ");
    expect(found[0].shown).toEqual([1, 3]);
  });
});
