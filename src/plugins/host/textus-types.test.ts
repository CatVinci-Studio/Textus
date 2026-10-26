// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * textus.d.ts names every part of the API the host runtime gives a plugin,
 * and nothing it doesn't: the runtime runs here windowless, its `textus` walked.
 */

const ROOT = join(__dirname, "..", "..", "..");
const HOST = readFileSync(join(__dirname, "runtime", "host.js"), "utf8");
const TYPES = readFileSync(join(ROOT, "docs", "dev", "textus.d.ts"), "utf8");

/** Every `namespace.member` of the runtime's textus object. */
function runtimeMembers(): string[] {
  const w = window as unknown as Record<string, unknown>;
  w.createEndpoint = () => ({ call: () => Promise.resolve(), notify() {} });
  new Function("createEndpoint", HOST)(w.createEndpoint);
  const api = w.textus as Record<string, Record<string, unknown>>;
  const out: string[] = [];
  for (const [ns, part] of Object.entries(api))
    for (const name of Object.getOwnPropertyNames(part))
      out.push(`${ns}.${name}`);
  return out;
}

/** An interface's body in the declaration file. */
function declaredBody(iface: string): string | undefined {
  return new RegExp(`interface ${iface} \\{([\\s\\S]*?)\\n    \\}`).exec(
    TYPES,
  )?.[1];
}

/** The members the declaration file gives an interface. */
function declared(iface: string): string[] {
  const body = declaredBody(iface);
  if (!body) return [];
  return [...body.matchAll(/^ {6}(?:readonly )?(\w+)[(?:<]/gm)].map(
    (m) => m[1],
  );
}

/** Each namespace of `textus` and its interface, as `interface Api` lists
 *  them. */
const INTERFACES: Record<string, string> = Object.fromEntries(
  [...(declaredBody("Api") ?? "").matchAll(/^ {6}(\w+): (\w+);/gm)].map((m) => [
    m[1],
    m[2],
  ]),
);

describe("textus.d.ts", () => {
  it("declares every part of the plugin API, and only those", () => {
    const actual = runtimeMembers().sort();
    const types = Object.entries(INTERFACES)
      .flatMap(([ns, iface]) => declared(iface).map((m) => `${ns}.${m}`))
      .sort();
    expect(types).toEqual(actual);
  });
});
