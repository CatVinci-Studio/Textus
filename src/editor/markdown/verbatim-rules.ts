/**
 * Syntax a document type keeps exactly as written, as plain data: apart
 * from the remark plugin (verbatim.ts) so naming a document loads no
 * editor at startup.
 */
export interface VerbatimRules {
  /** A top-level paragraph starting with one of these is kept whole, with
   *  the blocks after it while a bracket it opened is still open. */
  blockStarts: string[];
  /** `{…}` with balanced braces, in any line of text. */
  braces: boolean;
  /** JSX: `<Tag …>`, `</Tag>`, `<>`; a paragraph opening with one that
   *  isn't plain HTML is kept whole. */
  jsx: boolean;
}

const MDX: VerbatimRules = {
  blockStarts: ["import ", "export ", "{", ":::"],
  braces: true,
  jsx: true,
};

/** Textus's own document types that keep syntax, by extension. */
export const BUILT_IN_KEEP: Readonly<Record<string, VerbatimRules>> = {
  mdx: MDX,
};
