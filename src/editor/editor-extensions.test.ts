import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The editor's key handlers run in the order they're registered, and some
// must see a key before others: the open / panel first, then a plugin
// holding the keyboard, the
// table's arrows before gfm's own, the inline delimiters before the block
// keys, Read Only last of all.
const ORDER = [
  "createCompletionPlugin",
  "editorExtensions().keyInput",
  "macNavigationPlugin",
  "linuxImeEnterPlugin",
  "compositionPruneGuardPlugin",
  "tableEdgeArrowPlugin",
  "gfmWithoutStrikethrough",
  "createGithubAlertPlugin",
  "createMdSpanAutopairPlugin",
  "createBracketAutopairPlugin",
  "formatShortcutPlugin",
  "enclosurePlugin",
  "mathAutopairPlugin",
  "headingMarkerPlugin",
  "createLinkRevealPlugin",
  "pastePlainTextKeyPlugin",
  "blockKeysPlugin",
  "tabExtendPlugin",
  "tabStaysPlugin",
  "escapeTrailingBlockPlugin",
  "blockJoinPlugin",
  "inlineSourcePlugin",
  "findReplacePlugin",
  "readOnlyPlugin",
];

describe("the editor's key handlers", () => {
  it("are registered in the order they must see keys", () => {
    const source = readFileSync("src/editor/editor-extensions.ts", "utf8");
    // A writing-only plugin is registered as `.use(editing(name))`.
    const used = (name: string) =>
      [`.use(${name}`, `.use(editing(${name}`]
        .map((form) => source.indexOf(form))
        .find((i) => i >= 0) ?? -1;
    const at = ORDER.map((name) =>
      used(name) >= 0
        ? used(name)
        : source.indexOf(`${name}(`, source.indexOf(".use(")),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});
