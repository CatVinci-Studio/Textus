import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
// @ts-expect-error - a plain script, without types
import { reference } from "../../scripts/plugin-reference.mjs";

/** The reference page is what textus.d.ts makes: change the d.ts, then
 *  run `node scripts/plugin-reference.mjs`. */
it("docs/dev/plugin-reference.md is up to date with textus.d.ts", async () => {
  const page = readFileSync(
    new URL("../../docs/dev/plugin-reference.md", import.meta.url),
    "utf8",
  );
  expect(page).toBe(await reference());
});
