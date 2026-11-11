import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { WHEN_KEYS } from "./contributions/when";
import { WEBVIEW_THEME_VARS } from "./views/theme-vars";

/** What the plugin docs and Create mode's guide state as fact, held to the
 *  code: a wrong fact there becomes a plugin that silently does nothing. */
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const DOCS = [
  "docs/dev/plugins/guide.md",
  "docs/dev/plugins/pages.md",
  "docs/dev/plugins/ui.md",
  "docs/dev/plugins/permissions.md",
  "docs/dev/plugins/skill/SKILL.md",
  "docs/dev/textus.d.ts",
  "src-tauri/src/ai/skills/plugin.md",
];

it("states the API version the runtime answers", () => {
  const version = /API_VERSION = "([\d.]+)"/.exec(
    read("src/plugins/host/runtime/host.js"),
  )![1];
  expect(read("docs/dev/textus.d.ts")).toContain(
    `The Textus plugin API, ${version}:`,
  );
  expect(read("docs/dev/textus.d.ts")).toContain(
    `This API's version: "${version}"`,
  );
});

it("names only menu conditions Textus sets", () => {
  for (const doc of DOCS)
    for (const m of read(doc).matchAll(/`(\w+) [=!]= /g))
      expect(WHEN_KEYS, `${doc}: ${m[1]}`).toContain(m[1]);
});

it("names only style variables a plugin page is given", () => {
  // The theme's, and what the stylesheets a page shares with the window define.
  const given = new Set<string>(WEBVIEW_THEME_VARS);
  for (const css of [
    "src/engine/tokens/design-system.css",
    "src/engine/controls/components.css",
    "src/engine/controls/controls.css",
    "src/engine/motion/motion.css",
  ])
    for (const m of read(css).matchAll(/(--[a-z][\w-]*)\s*:/g)) given.add(m[1]);
  for (const doc of DOCS)
    for (const m of read(doc).matchAll(/`(--[a-z][\w-]*)`/g))
      expect(given.has(m[1]), `${doc}: ${m[1]}`).toBe(true);
});

it("gives every permission a row on the permissions page", () => {
  const names = (
    JSON.parse(read("src/plugins/store/permissions.json")) as {
      plain: string[];
    }
  ).plain;
  const page = read("docs/dev/plugins/permissions.md");
  expect(names.length).toBeGreaterThan(5);
  for (const name of names) expect(page, name).toContain(`| \`${name}\``);
});
