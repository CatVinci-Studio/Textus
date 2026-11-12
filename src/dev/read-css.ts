import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A stylesheet's text with its relative `@import`s read in, in place:
 *  what the page gets from it, for tests that read stylesheets. */
export function readCss(path: string): string {
  return readFileSync(path, "utf8").replace(
    /@import\s+"(\.{1,2}\/[^"]+\.css)";/g,
    (_, file: string) => readCss(join(dirname(path), file)),
  );
}
