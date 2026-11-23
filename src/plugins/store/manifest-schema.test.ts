import { readFileSync } from "node:fs";
import PERMISSIONS from "./permissions.json";
import { PERMISSION_LABELS } from "./permissions";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPermission } from "./manifest";
import { REQUIRED_SETTINGS } from "./manifest-types";
import { MENU_IDS } from "./manifest-parse";
import { PLUGIN_CATEGORIES } from "./plugin-categories";

/**
 * The manifest JSON schema says what the parser reads: the same permissions,
 * menus and required settings, and a field for every one it takes.
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
// A plugin's contributions are read apart, by manifest-parse.ts.
const PARSE_TS = readFileSync(join(__dirname, "manifest-parse.ts"), "utf8");
const props = SCHEMA.properties;
const contributes = props.contributes.properties;

describe("textus-plugin.schema.json", () => {
  it("names the permissions the parser accepts", () => {
    const plain: string[] = props.permissions.items.anyOf[0].enum;
    for (const p of plain) expect(isPermission(p)).toBe(true);
    expect(isPermission("network:api.example.com")).toBe(true);
    // The schema's are the one list (permissions.json), each with its
    // words; and the host rule judges the shared cases as Rust does.
    expect([...plain].sort()).toEqual([...PERMISSIONS.plain].sort());
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual(
      [...PERMISSIONS.plain].sort(),
    );
    for (const p of PERMISSIONS.hosts.valid)
      expect(isPermission(p), p).toBe(true);
    for (const p of PERMISSIONS.hosts.invalid)
      expect(isPermission(p), p).toBe(false);
  });

  it("names the menus, the settings a plugin can need and the categories", () => {
    expect(contributes.menus.propertyNames.enum).toEqual([...MENU_IDS]);
    expect(props.requires.items.properties.setting.enum).toEqual([
      ...REQUIRED_SETTINGS,
    ]);
    expect(props.category.enum).toEqual([...PLUGIN_CATEGORIES]);
  });

  it("has a field for every one the parser reads", () => {
    const top = [...MANIFEST_TS.matchAll(/\bm\.(\w+)/g)].map((m) => m[1]);
    for (const field of new Set(top)) expect(props).toHaveProperty(field);
    const parts = [...PARSE_TS.matchAll(/\bc\.(\w+)/g)].map((m) => m[1]);
    expect(parts.length).toBeGreaterThan(0);
    for (const field of new Set(parts))
      expect(contributes).toHaveProperty(field);
  });
});
