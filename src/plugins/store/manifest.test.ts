import { describe, expect, it } from "vitest";
import {
  compareVersions,
  engineSatisfied,
  isPermission,
  localize,
  matchesFilename,
  ManifestError,
  parseManifest,
} from "./manifest";

const base = {
  id: "catvinci.example",
  name: "Example",
  version: "1.0.0",
  publisher: "catvinci",
  engines: { textus: "^1.3.0" },
};

describe("a plugin's manifest", () => {
  it("reads what a plugin adds", () => {
    const m = parseManifest({
      ...base,
      main: "host.js",
      activationEvents: ["onCommand:catvinci.example.hello"],
      permissions: ["files.read", "network:api.zotero.org"],
      contributes: {
        commands: [{ command: "catvinci.example.hello", title: "%hello%" }],
        keybindings: [
          { command: "catvinci.example.hello", key: "Mod+Shift+H" },
        ],
        menus: { "editor/context": [{ command: "catvinci.example.hello" }] },
        customEditors: [
          {
            viewType: "catvinci.example.pdf",
            displayName: "PDF",
            filenamePatterns: ["*.PDF"],
          },
        ],
        settings: [
          {
            key: "zoom",
            type: "enum",
            default: "fit",
            title: "Zoom",
            options: [
              { value: "fit", label: "Fit" },
              { value: "100", label: "100%" },
            ],
          },
        ],
      },
      l10n: { en: { hello: "Say hello" }, zh: { hello: "打个招呼" } },
    });
    expect(m.contributes.keybindings[0].key).toBe("mod+shift+h");
    expect(m.contributes.customEditors[0]).toMatchObject({
      filenamePatterns: ["*.pdf"],
      priority: "default",
    });
    expect(localize(m, m.contributes.commands[0].title, "zh-Hant")).toBe(
      "打个招呼",
    );
    expect(localize(m, "%hello%", "fr")).toBe("Say hello");
    expect(localize(m, "Plain", "zh")).toBe("Plain");
  });

  it("refuses what would let a plugin take another's place or reach more", () => {
    const bad = (extra: object) => () => parseManifest({ ...base, ...extra });
    expect(bad({ id: "Example" })).toThrow(ManifestError);
    expect(bad({ version: "1" })).toThrow(/version/);
    expect(bad({ permissions: ["root"] })).toThrow(/permission/);
    expect(
      bad({
        contributes: { commands: [{ command: "other.cmd", title: "x" }] },
      }),
    ).toThrow(/must start with "catvinci.example."/);
    expect(
      bad({
        contributes: {
          keybindings: [{ command: "catvinci.example.x", key: "a" }],
        },
      }),
    ).toThrow(/not in contributes.commands/);
    expect(bad({ contributes: { menus: { "window/title": [] } } })).toThrow(
      /no menu/,
    );
    expect(bad({ engines: {} })).toThrow(/engines.textus/);
    expect(() => parseManifest("{nope")).toThrow(/not JSON/);
  });

  it("reads where a plugin suggests completions, and refuses a bad pattern", () => {
    const m = parseManifest({
      ...base,
      contributes: {
        completions: [
          { id: "catvinci.example.tex", where: "math", pattern: "\\\\[a-z]*" },
          { id: "catvinci.example.any", pattern: "@\\w*" },
        ],
      },
    });
    expect(m.contributes.completions).toEqual([
      { id: "catvinci.example.tex", where: "math", pattern: "\\\\[a-z]*" },
      { id: "catvinci.example.any", where: "any", pattern: "@\\w*" },
    ]);
    const bad = (c: object) => () =>
      parseManifest({ ...base, contributes: { completions: [c] } });
    expect(bad({ id: "catvinci.example.x", pattern: "(" })).toThrow(
      /not a regular expression/,
    );
    expect(
      bad({ id: "catvinci.example.x", where: "code", pattern: "a" }),
    ).toThrow(/where/);
    expect(bad({ id: "other.x", pattern: "a" })).toThrow(/must start with/);
  });

  it("reads the links a plugin opens, each to one of its commands", () => {
    const command = { command: "catvinci.example.open", title: "Open" };
    const m = parseManifest({
      ...base,
      contributes: {
        commands: [command],
        links: [{ pattern: "^https?://", command: command.command }],
      },
    });
    expect(m.contributes.links).toEqual([
      { pattern: "^https?://", command: "catvinci.example.open" },
    ]);
    const bad = (link: object) => () =>
      parseManifest({
        ...base,
        contributes: { commands: [command], links: [link] },
      });
    expect(bad({ pattern: "(", command: command.command })).toThrow(
      /not a regular expression/,
    );
    expect(bad({ pattern: "a", command: "catvinci.example.other" })).toThrow(
      /not in contributes.commands/,
    );
  });

  it("reads what a document must hold for the plugin to be suggested, leaving out kinds it doesn't know", () => {
    const m = parseManifest({
      ...base,
      contributes: { suggestFor: ["wikilinks", "a-later-kind"] },
    });
    expect(m.contributes.suggestFor).toEqual(["wikilinks"]);
    expect(parseManifest(base).contributes.suggestFor).toEqual([]);
  });

  it("names network permissions by host", () => {
    expect(isPermission("network:api.zotero.org")).toBe(true);
    expect(isPermission("network:*.wikipedia.org")).toBe(true);
    expect(isPermission("network:localhost:23119")).toBe(true);
    expect(isPermission("network:*")).toBe(true);
    expect(isPermission("network:")).toBe(false);
    expect(isPermission("network:a b")).toBe(false);
  });
});

describe("a plugin's background code (API 1.1)", () => {
  it("is read with the notifications and background permissions", () => {
    const m = parseManifest({
      ...base,
      main: "host.js",
      background: "background.js",
      permissions: ["notifications", "background"],
    });
    expect(m.background).toBe("background.js");
    expect(m.permissions).toEqual(["notifications", "background"]);
    expect(parseManifest(base).background).toBeUndefined();
  });
});

describe("a plugin's settings", () => {
  const withSettings = (settings: unknown[]) =>
    parseManifest({ ...base, contributes: { settings } });

  it("reads every kind, with groups, conditions and bounds", () => {
    const m = withSettings([
      { key: "on", type: "boolean", default: true, title: "On", group: "A" },
      {
        key: "tint",
        type: "color",
        default: "#AABBCC",
        title: "Tint",
        when: "on",
      },
      { key: "h", type: "number", default: 3, min: 1, max: 9, title: "H" },
      { key: "words", type: "list", default: ["a"], title: "Words" },
      {
        key: "go",
        type: "button",
        command: "catvinci.example.go",
        title: "Go",
      },
    ]);
    const [on, tint, h, words, go] = m.contributes.settings;
    expect(on.group).toBe("A");
    expect(tint.when).toBe("on");
    expect([h.min, h.max]).toEqual([1, 9]);
    expect(words.default).toEqual(["a"]);
    expect(go.command).toBe("catvinci.example.go");
    expect(go.default).toBeUndefined();
  });

  it("refuses a default of the wrong kind, a bad condition, or one on no setting", () => {
    const bad: [unknown, RegExp][] = [
      [{ key: "c", type: "color", default: "blue", title: "C" }, /colour/],
      [{ key: "l", type: "list", default: "a", title: "L" }, /list of strings/],
      [
        { key: "b", type: "button", default: 1, command: "x", title: "B" },
        /left out/,
      ],
      [{ key: "b", type: "button", title: "B" }, /command/],
      [{ key: "n", type: "number", default: 0, min: 1, title: "N" }, /within/],
      [
        { key: "w", type: "string", default: "", title: "W", when: "a ==" },
        /when/,
      ],
      [
        { key: "w", type: "string", default: "", title: "W", when: "ghost" },
        /no setting/,
      ],
      [{ key: "x", type: "date", default: "", title: "X" }, /type/],
    ];
    for (const [setting, message] of bad)
      expect(() => withSettings([setting])).toThrow(message);
  });
});

describe("versions", () => {
  it("order as semver, a pre-release before its release", () => {
    expect(compareVersions("1.3.0-beta.1", "1.3.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
  });

  it("match a plugin's engine range, a beta counting as its release", () => {
    expect(engineSatisfied("^1.3.0", "1.3.0-beta.1")).toBe(true);
    expect(engineSatisfied("^1.3.0", "1.4.2")).toBe(true);
    expect(engineSatisfied("^1.3.0", "2.0.0")).toBe(false);
    expect(engineSatisfied("^1.4.0", "1.3.0")).toBe(false);
    expect(engineSatisfied(">=1.3.0", "2.1.0")).toBe(true);
    expect(engineSatisfied("1.3.x", "1.3.7")).toBe(true);
    expect(engineSatisfied("1.3.x", "1.4.0")).toBe(false);
    expect(engineSatisfied("*", "9.0.0")).toBe(true);
  });

  it("tell the betas apart when the range names one", () => {
    expect(engineSatisfied(">=1.3.0-beta.2", "1.3.0-beta.1")).toBe(false);
    expect(engineSatisfied(">=1.3.0-beta.2", "1.3.0-beta.2")).toBe(true);
    expect(engineSatisfied(">=1.3.0-beta.2", "1.3.0")).toBe(true);
    expect(engineSatisfied("^1.3.0-beta.2", "1.3.0-beta.1")).toBe(false);
    expect(engineSatisfied("^1.3.0-beta.2", "1.4.0")).toBe(true);
  });
});

it("file name patterns match with * and without regard to case", () => {
  expect(matchesFilename("*.pdf", "Paper.PDF")).toBe(true);
  expect(matchesFilename("*.kanban.md", "todo.kanban.md")).toBe(true);
  expect(matchesFilename("*.kanban.md", "notes.md")).toBe(false);
  expect(matchesFilename("*.md", "a.md.bak")).toBe(false);
});
