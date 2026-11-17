import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// A combining mark (H̄'s bar) sits over its letter only when one face draws
// both; in Chromium the CJK faces put it beside. In a CJK UI a Latin face
// leads the text stack.
it("leads a CJK interface's text stack with a Latin face", () => {
  const css = readFileSync(join(__dirname, "base.css"), "utf8");
  const rule =
    /:root:is\(:lang\(zh\), :lang\(ja\), :lang\(ko\)\) \{\s*--font-text-sans:\s*([^;]+);/.exec(
      css,
    );
  expect(rule?.[1].trim().startsWith('"Segoe UI", var(--font-cjk-sans)')).toBe(
    true,
  );
});
