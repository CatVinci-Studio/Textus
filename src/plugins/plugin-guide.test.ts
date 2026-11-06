import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** What a plugin can call or declare: every method and event of textus.d.ts's
 *  interfaces, the Api's namespaces, and the manifest's contribution points. */
function apiNames(): string[] {
  const dts = read("docs/dev/textus.d.ts");
  const names = new Set<string>();
  for (const m of dts.matchAll(/^ {6}(\w+)\??(?:<[^>]*>)?\(/gm))
    names.add(m[1]);
  for (const m of dts.matchAll(/^ {6}(\w+)\??:\s*Event</gm)) names.add(m[1]);
  const at = dts.indexOf("interface Api {");
  for (const m of dts
    .slice(at, dts.indexOf("}", at))
    .matchAll(/^ {6}(\w+)\??:/gm))
    names.add(m[1]);
  const schema = JSON.parse(read("docs/dev/textus-plugin.schema.json")) as {
    properties: { contributes: { properties: Record<string, unknown> } };
  };
  for (const key of Object.keys(schema.properties.contributes.properties))
    names.add(key);
  return [...names];
}

it("Create mode's plugin guide names everything textus.d.ts offers", () => {
  const guide = read("src-tauri/src/ai/skills/plugin.md");
  const names = apiNames();
  expect(names.length).toBeGreaterThan(100);
  expect(
    names.filter((name) => !new RegExp(`\\b${name}\\b`).test(guide)),
  ).toEqual([]);
});
