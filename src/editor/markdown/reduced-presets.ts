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

// Bold/italic/strikethrough/inline code are handled by our own md_span /
// md_code_span nodes instead (see md-span-schema.ts) - real, always-editable
// nodes rather than marks whose delimiter syntax has to be faked in and out
// of existence around cursor movement. These bundles are the stock
// commonmark/gfm presets with just those four marks' schemas, input rules,
// keymaps, and toggle commands removed; everything else each preset
// provides (paragraphs, headings, lists, code blocks, tables, task lists,
// footnotes, links, images, ...) is untouched.
//
// remarkPreserveEmptyLinePlugin is excluded because of what it does on
// OUTPUT: while it is registered, the paragraph serializer writes every
// empty paragraph as a literal `<br />` placeholder (so blank lines survive
// a round trip) - which polluted saved files AND the markdown shown to the
// AI with non-standard HTML. Without it, empty paragraphs collapse on
// save/reload per normal markdown semantics; a lone `<br />` in an existing
// file still parses and gets normalized to a hardbreak on first edit by
// br-hardbreak-plugin (table cells keep theirs - GFM has no alternative).
//
// htmlSchema/htmlAttr are excluded too: raw-html-schema.ts replaces it with
// a real-text node (stock's is an attrs-based atom whose toDOM just echoes
// the tag text back as a string) so a whitelist of common tags can actually
// render - see raw-html-preview-plugin.ts. Milkdown's parser matches mdast
// node types by "first schema whose match() returns true, by registration
// order" (@milkdown/transformer's ParserState#matchTarget) with no parent
// context available to disambiguate, so excluding the stock schema outright
// is the only way to guarantee the replacement wins, rather than hoping
// registration order works out.
//
// syncListOrderPlugin is excluded because it redraws the list item being
// typed in. It rewrites each ordered item's `label`/`listType` attrs from an
// appendTransaction, but skips non-generic transactions - Enter's split and
// the "1. " input rule among them - so a fresh item is relabelled on the
// NEXT edit instead. With an IME that edit is the first keystroke of a
// composition: the attr change makes ProseMirror replace the <li> (and the
// paragraph holding the preedit) mid-composition, and WebKitGTK commits the
// text a second time, or garbles it, inside a stray empty line. Neither attr
// does anything here: numbering is a CSS counter on the parent <ol> (see
// milkdown-theme.css) and list_item's toMarkdown never reads them.
//
// syncHeadingIdPlugin is excluded because it walked the whole document
// after every edit; heading-id-plugin.ts gives the same ids, worked out
// only after an edit to a heading.
//
// remarkInlineLinkPlugin is excluded because it rewrote every reference
// link, `[text][ref]`, as an inline one and deleted the `[ref]: url`
// definitions: the first save of an edit dropped them from the file.
// reference-links.ts reads references and definitions instead.
//
// wrapInHeadingInputRule is replaced by headingInputRule below: it made a
// heading of any number of "#"s, and "####### " gave a level-7 heading,
// drawn as an unknown <h7> element and saved as "######". insertHrInputRule
// and wrapInOrderedListInputRule are replaced by ruleInputRule and
// orderedListInputRule: "---" on the first line is front matter's start,
// and "1) " is a list as well as "1. ".
//
// $markSchema/$nodeSchema (and some other composable pieces) return
// array-like tuples that get spread apart by the presets' own internal
// `.flat()` calls - flattening this exclusion list the same way before
// building the lookup set is what makes `!==`-by-reference filtering below
// actually match the individual pieces sitting in `commonmark`/`gfm`.
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

// autoInsertSpanPlugin (prosemirror-safari-ime-span) is left out on Linux.
// It keys off navigator.vendor "Apple Computer", which WebKitGTK reports
// too, and parks an empty <span> widget at the caret for the length of a
// composition - Safari's fix for its commit pruning an emptied node. On
// WebKitGTK it doesn't stop that pruning (composition-prune-guard-plugin
// does), and the widget is redrawn beside the preedit on every keystroke:
// a commit then left it inside the text, splitting "ni hao" into "n" and
// "i hao" across two list items.
const excludedGfmPieces = [
  strikethroughSchema,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  toggleStrikethroughCommand,
  ...(isLinuxPlatform() ? [autoInsertSpanPlugin] : []),
].flat();

/** "# " to "###### " at the start of a line makes that heading; in a
 *  heading, the "#"s typed add to its level, up to 6 - as the stock rule. */
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

/** "---", "___ " or "*** " alone on a line makes a rule - except "---" on
 *  the document's first line, which Enter turns into front matter
 *  (block-keys-plugin.ts); "--- " makes a rule there. */
export const ruleInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /^(?:---|---\s|___\s|\*\*\*\s)$/,
      (state, match, start, end) => {
        const $start = state.doc.resolve(start);
        const firstLine = $start.depth === 1 && $start.index(0) === 0;
        if (match[0] === "---" && firstLine) return null;
        // The rule goes above the line, which keeps the caret and any text
        // after it.
        return state.tr
          .delete(start, end)
          .insert($start.before(), hrSchema.type(ctx).create());
      },
    ),
);

/** "1. " or "1) " at the start of a line starts an ordered list from that
 *  number, joined to a list right above that it continues - the stock
 *  rule, which took only the dot. */
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
