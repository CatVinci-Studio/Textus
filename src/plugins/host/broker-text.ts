import { countWords } from "../../utils/word-count";
import { splitFrontmatter } from "../../utils/frontmatter";
import { str, type Params } from "./broker-scope";

/** Text as the app reads it, for plugins: the status bar's word count, a
 *  note's front matter split from its body. No permission: plain text in,
 *  plain values out. */
export function textHandlers() {
  return {
    "text.count": ({ markdown }: Params) =>
      countWords(str(markdown, "markdown")),
    "text.splitFrontmatter": ({ text }: Params) =>
      splitFrontmatter(str(text, "text")),
  };
}
