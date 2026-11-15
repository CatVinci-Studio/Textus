import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (name.endsWith(".tsx") && !name.includes(".test.")) yield path;
  }
}

describe("buttons in a settings row", () => {
  it("each carries a class, so none shows the browser's own button", () => {
    const bare: string[] = [];
    for (const file of sources("src/settings")) {
      const text = readFileSync(file, "utf8");
      for (const [row] of text.matchAll(/<SettingRow\b[\s\S]*?<\/SettingRow>/g))
        for (const [, attrs] of row.matchAll(/<button\b([^>]*)>/g))
          if (!/className|\{\.\.\./.test(attrs)) bare.push(file);
    }
    expect(bare).toEqual([]);
  });
});
