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
      permissions: ["workspace.read", "network:api.zotero.org"],
      contributes: {
        commands: [{ command: "catvinci.example.hello", title: "%hello%" }],
        keybindings: [{ command: "catvinci.example.hello", key: "Mod+Shift+H" }],
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
      bad({ contributes: { commands: [{ command: "other.cmd", title: "x" }] } }),
    ).toThrow(/must start with "catvinci.example."/);
    expect(
      bad({
        contributes: { keybindings: [{ command: "catvinci.example.x", key: "a" }] },
      }),
    ).toThrow(/not in contributes.commands/);
    expect(bad({ contributes: { menus: { "window/title": [] } } })).toThrow(
      /no menu/,
    );
    expect(bad({ engines: {} })).toThrow(/engines.textus/);
    expect(() => parseManifest("{nope")).toThrow(/not JSON/);
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
});

it("file name patterns match with * and without regard to case", () => {
  expect(matchesFilename("*.pdf", "Paper.PDF")).toBe(true);
  expect(matchesFilename("*.kanban.md", "todo.kanban.md")).toBe(true);
  expect(matchesFilename("*.kanban.md", "notes.md")).toBe(false);
  expect(matchesFilename("*.md", "a.md.bak")).toBe(false);
});
