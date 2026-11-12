import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_DEFAULTS } from "./doc-defaults";

const css = readFileSync(new URL("./base.css", import.meta.url), "utf8");

/** The value of `--doc-<name>` in the first block after `marker`. */
function declared(marker: string, name: string): string | undefined {
  const from = css.indexOf(marker);
  return new RegExp(`--doc-${name}:\\s*([^;]+);`).exec(css.slice(from))?.[1];
}

describe("DOC_DEFAULTS", () => {
  it("are base.css's document colours, light and dark", () => {
    for (const [name, value] of Object.entries(DOC_DEFAULTS.light))
      expect(declared("--doc-bg:", name), name).toBe(value);
    for (const [name, value] of Object.entries(DOC_DEFAULTS.dark))
      expect(declared("@media (prefers-color-scheme: dark)", name), name).toBe(
        value,
      );
  });
});
