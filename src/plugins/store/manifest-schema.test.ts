import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SETTINGS, isPermission } from "./manifest";
import { MENU_IDS } from "./manifest-parse";

/**
 * docs/dev/textus-plugin.schema.json says what manifest.ts reads: the same
 * permissions, menus and required settings, and a field for every one the
 * parser takes.
 */

const SCHEMA = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "docs",
      "dev",
      "textus-plugin.schema.json",
    ),
    "utf8",
  ),
);
const MANIFEST_TS = readFileSync(join(__dirname, "manifest.ts"), "utf8");
const props = SCHEMA.properties;
const contributes = props.contributes.properties;

describe("textus-plugin.schema.json", () => {
  it("names the permissions the parser accepts", () => {
    const plain: string[] = props.permissions.items.anyOf[0].enum;
    for (const p of plain) expect(isPermission(p)).toBe(true);
    expect(isPermission("network:api.example.com")).toBe(true);
    // Every plain permission manifest.ts knows is in the schema.
    const known = /const PLAIN_PERMISSIONS = \[([\s\S]*?)\]/
      .exec(MANIFEST_TS)![1]
      .match(/"[^"]+"/g)!
      .map((s) => s.slice(1, -1));
    expect([...plain].sort()).toEqual([...known].sort());
  });

  it("names the menus and the settings a plugin can need", () => {
    expect(contributes.menus.propertyNames.enum).toEqual([...MENU_IDS]);
    expect(props.requires.items.properties.setting.enum).toEqual([
      ...REQUIRED_SETTINGS,
    ]);
  });

  it("has a field for every one the parser reads", () => {
    const top = [...MANIFEST_TS.matchAll(/\bm\.(\w+)/g)].map((m) => m[1]);
    for (const field of new Set(top)) expect(props).toHaveProperty(field);
    const parts = [...MANIFEST_TS.matchAll(/\bc\.(\w+)/g)].map((m) => m[1]);
    for (const field of new Set(parts))
      expect(contributes).toHaveProperty(field);
  });
});
