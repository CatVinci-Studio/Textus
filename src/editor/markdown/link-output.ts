import type { Handle, Unsafe } from "mdast-util-to-markdown";

/** What serializing links leaves to remark: a URL typed as plain text. */

export type PeekingHandle = Handle & { peek: Handle };

/**
 * A URL or email typed as plain text is written as typed: remark-gfm's
 * escapes (`https\://x.org`, `a\@b.com`) kept it from linking on GitHub.
 * The guards are dropped from this serialization's own unsafe list.
 */
export const isAutolinkLiteralGuard = (pattern: Unsafe) =>
  (pattern.character === "@" && pattern.before === "[+\\-.\\w]") ||
  (pattern.character === "." && pattern.before === "[Ww]") ||
  (pattern.character === ":" && pattern.before === "[ps]");
