import { countWords } from "../../utils/word-count";
import { splitFrontmatter } from "../../utils/frontmatter";
import { str, type Params } from "./broker-scope";

/** Text as the app reads it, for plugins: the status bar's word count, a
 *  note's front matter split from its body, YAML read and written in full.
 *  No permission: plain text in, plain values out. */
export function textHandlers() {
  return {
    "text.count": ({ markdown }: Params) =>
      countWords(str(markdown, "markdown")),
    "text.splitFrontmatter": ({ text }: Params) =>
      splitFrontmatter(str(text, "text")),
    "text.parseYaml": async ({ yaml }: Params) =>
      (await import("../../utils/frontmatter-yaml")).parseYamlFull(
        str(yaml, "yaml"),
      ),
    "text.stringifyYaml": async ({ value }: Params) =>
      (await import("../../utils/frontmatter-yaml")).stringifyYamlFull(value),
  };
}
