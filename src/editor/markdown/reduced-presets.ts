import {
  commonmark,
  strongSchema,
  strongAttr,
  strongInputRule,
  strongKeymap,
  toggleStrongCommand,
  emphasisSchema,
  emphasisAttr,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  emphasisKeymap,
  toggleEmphasisCommand,
  inlineCodeSchema,
  inlineCodeAttr,
  inlineCodeInputRule,
  inlineCodeKeymap,
  toggleInlineCodeCommand,
  htmlSchema,
  htmlAttr,
  remarkInlineLinkPlugin,
  remarkPreserveEmptyLinePlugin,
  syncHeadingIdPlugin,
  syncListOrderPlugin,
  wrapInHeadingInputRule,
  headingSchema,
  insertHrInputRule,
  hrSchema,
  wrapInOrderedListInputRule,
  orderedListSchema,
} from "@milkdown/kit/preset/commonmark";
import {
  autoInsertSpanPlugin,
  gfm,
  strikethroughSchema,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  InputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "@milkdown/kit/prose/inputrules";
import { $inputRule } from "@milkdown/kit/utils";
import { isLinuxPlatform } from "../../platform/os";

// The stock commonmark/gfm presets minus what Textus replaces or must avoid:
// - bold/italic/strike/inline code marks: md_span nodes instead;
// - remarkPreserveEmptyLinePlugin: it saved empty paragraphs as `<br />`;
// - htmlSchema: replaced by a real-text node, and the parser takes the first
//   matching schema, so the stock one must be gone;
// - syncListOrderPlugin: its late attr change replaced the <li> mid-IME
//   composition; numbering is a CSS counter anyway;
// - syncHeadingIdPlugin: it walked the whole document after every edit;
// - remarkInlineLinkPlugin: it rewrote reference links and dropped their
//   definitions on save;
// - three input rules, replaced below (level-7 headings, "---" on line one,
//   "1) " lists).
// The pieces are tuples the presets `.flat()`, so this list is flattened too.
const excludedCommonmarkPieces = [
  strongSchema,
  strongAttr,
  strongInputRule,
  strongKeymap,
  toggleStrongCommand,
  emphasisSchema,
  emphasisAttr,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  emphasisKeymap,
  toggleEmphasisCommand,
  inlineCodeSchema,
  inlineCodeAttr,
  inlineCodeInputRule,
  inlineCodeKeymap,
  toggleInlineCodeCommand,
  htmlSchema,
  htmlAttr,
  remarkPreserveEmptyLinePlugin,
  syncListOrderPlugin,
  syncHeadingIdPlugin,
  remarkInlineLinkPlugin,
  wrapInHeadingInputRule,
  insertHrInputRule,
  wrapInOrderedListInputRule,
].flat();

// autoInsertSpanPlugin is left out on Linux: WebKitGTK passes its Safari
// vendor check, and its caret <span> widget, redrawn on every keystroke,
// ended up inside the committed text.
const excludedGfmPieces = [
  strikethroughSchema,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  toggleStrikethroughCommand,
  ...(isLinuxPlatform() ? [autoInsertSpanPlugin] : []),
].flat();

/** "# " to "###### " makes that heading; in a heading, the "#"s typed add
 *  to its level, up to 6. */
export const headingInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^(#{1,6})\s$/, headingSchema.type(ctx), (match) => {
    const typed = match[1].length;
    const { $from } = ctx.get(editorViewCtx).state.selection;
    const block = $from.parent;
    const level =
      block.type.name === "heading" ? Number(block.attrs.level) + typed : typed;
    return { level: Math.min(level, 6) };
  }),
);

/** "---", "___ " or "*** " alone on a line makes a rule, except "---" on the
 *  first line, which Enter turns into front matter. */
export const ruleInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /^(?:---|---\s|___\s|\*\*\*\s)$/,
      (state, match, start, end) => {
        const $start = state.doc.resolve(start);
        const firstLine = $start.depth === 1 && $start.index(0) === 0;
        if (match[0] === "---" && firstLine) return null;
        // The rule goes above the line, keeping the caret and any text after it.
        return state.tr
          .delete(start, end)
          .insert($start.before(), hrSchema.type(ctx).create());
      },
    ),
);

/** "1. " or "1) " at a line's start starts an ordered list from that number,
 *  joined to a list right above that it continues. */
export const orderedListInputRule = $inputRule((ctx) =>
  wrappingInputRule(
    /^\s*(\d+)[.)]\s$/,
    orderedListSchema.type(ctx),
    (match) => ({ order: Number(match[1]) }),
    (match, node) =>
      node.childCount + (node.attrs.order as number) === Number(match[1]),
  ),
);

const excludedCommonmarkSet = new Set<unknown>(excludedCommonmarkPieces);
const excludedGfmSet = new Set<unknown>(excludedGfmPieces);

export const commonmarkWithoutMarks = (commonmark as unknown[]).filter(
  (piece) => !excludedCommonmarkSet.has(piece),
) as typeof commonmark;
export const gfmWithoutStrikethrough = (gfm as unknown[]).filter(
  (piece) => !excludedGfmSet.has(piece),
) as typeof gfm;
