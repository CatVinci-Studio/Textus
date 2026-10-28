import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The function names in a Rust list of command paths. */
function names(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^\s*(?:\$?crate::)?(?:[\w]+::)*(\w+),\s*$/gm)].map(
      (match) => match[1],
    ),
  );
}

/** The text of every `macro![ ... ]` list in `source`, brackets matched:
 *  `#[cfg(...)]` lines sit inside them. */
function lists(source: string, macro: string): string {
  return source
    .split(`${macro}![`)
    .slice(1)
    .map((part) => {
      let depth = 1;
      for (let i = 0; i < part.length; i++) {
        if (part[i] === "[") depth++;
        if (part[i] === "]" && --depth === 0) return part.slice(0, i);
      }
      return part;
    })
    .join("\n");
}

describe("the backend's commands", () => {
  it("each have a handler for every binding the frontend is given", () => {
    const rust = (file: string) =>
      readFileSync(`src-tauri/src/${file}`, "utf8");
    const bound = names(lists(rust("bindings.rs"), "collect_commands"));
    const handled = names(
      lists(rust("lib.rs"), "with_plugin_commands") +
        lists(rust("plugins/mod.rs"), "generate_handler"),
    );
    expect(bound.size).toBeGreaterThan(150);
    expect([...bound].filter((name) => !handled.has(name))).toEqual([]);
  });
});
