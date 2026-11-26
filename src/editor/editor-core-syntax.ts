import { $remark } from "@milkdown/kit/utils";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { remarkStringifyOptionsCtx, type Editor } from "@milkdown/kit/core";
import { createRemarkVerbatim, keepFor } from "./markdown/verbatim";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import {
  commonmarkWithoutMarks,
  gfmWithoutStrikethrough,
  unalignedTableCells,
  headingInputRule,
  orderedListInputRule,
  ruleInputRule,
} from "./markdown/reduced-presets";
import {
  remarkFrontmatterPlugin,
  frontmatterSchema,
} from "./markdown/frontmatter-schema";
import { createGithubAlertPlugin } from "./markdown/github-alert-plugin";
import { inlineSyntaxPlugin } from "./markdown/inline-syntax-plugin";
import {
  headingIdPlugin,
  headingIdsOnParse,
} from "./markdown/heading-id-plugin";
import {
  createTocPlugin,
  remarkTocPlugin,
  tocSchema,
} from "./markdown/toc-plugin";
import { createHeadingFoldPlugin } from "./fold/heading-fold";
import { rawHtmlSchema } from "./html/raw-html-schema";
import { remarkHtmlImages } from "./images/image-html";
import { createRawHtmlPreviewPlugin } from "./html/raw-html-preview-plugin";
import { htmlAlignPlugin } from "./html/html-align";
import {
  brToHardbreakPlugin,
  remarkTableCellBreaks,
} from "./markdown/br-hardbreak-plugin";
import {
  remarkHighlightPlugin,
  remarkScriptsPlugin,
  remarkStrikethroughTildesPlugin,
  remarkEmphasisUnderscoresPlugin,
  mdSpanSchema,
  mdCodeSpanSchema,
  mdSpanClipboardPlugin,
} from "./marks/md-span-schema";
import { createMdSpanAutopairPlugin } from "./marks/md-span-autopair-plugin";
import { createColorSwatchPlugin } from "./marks/color-swatch-plugin";
import { emojiShortcodePlugin } from "./emoji/emoji-shortcode-plugin";
import { createBracketAutopairPlugin } from "./keys/bracket-autopair-plugin";
import { formatShortcutPlugin } from "./keys/format-shortcut-plugin";
import { selectAllKeyPlugin } from "./keys/select-all";
import { enclosurePlugin } from "./marks/enclosure";
import {
  linkDefinitionSchema,
  remarkReferenceLinksPlugin,
} from "./markdown/reference-links";
import {
  remarkWikilinkPlugin,
  wikilinkInputRule,
  wikilinkSchema,
} from "./markdown/wikilink";
import {
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineInputRule,
} from "./math/math-schema";
import { mathAutopairPlugin } from "./math/math-autopair-plugin";
import { createMathPreviewPlugin } from "./math/math-preview-plugin";
import { headingMarkerPlugin } from "./marks/heading-marker-plugin";
import {
  cjkTaskInputPlugin,
  remarkEmptyTaskItems,
  taskListClickPlugin,
} from "./markdown/task-list-plugin";
import { listTallLinePlugin } from "./markdown/list-tall-line-plugin";
import { syntaxHighlightPlugin } from "./code/syntax-highlight-plugin";
import { createCodeBlockView } from "./code/code-block-language-view";
import { createCodeLineNumbersPlugin } from "./code/code-line-numbers-plugin";
import { tableCaretPlugin } from "./tables/table-caret";
import { tableGrowth } from "./tables/table-growth";
import { keyboardCaretPlugin } from "./keyboard-caret-plugin";
import { tableKeys, tableRowPaste } from "./tables/table-keys";
import { clickBelowEnd } from "./click-below-end";
import {
  tableColumnFreeze,
  tableColumnResizing,
  createTableView,
} from "./tables/table-hover-view";
import { createMermaidPreviewPlugin } from "./mermaid-plugin";
import { wikilinkRevealPlugin } from "./markdown/wikilink-reveal";
import { tableEdgeArrowPlugin } from "./markdown/escape-trailing-block-plugin";
import { linkSchema, remarkLinkSourcePlugin } from "./markdown/link-source";
import {
  obsidianEmbedInputRule,
  obsidianEmbedSchema,
  remarkObsidianEmbedPlugin,
} from "./images/obsidian-embed";
import { createEmbedsPlugin } from "./embeds/embeds-plugin";
import { createMissingLinksPlugin } from "./markdown/missing-links";
import { resolveStrings } from "../i18n/strings";
import type { CoreEnv } from "./editor-core-env";
import { singleTildeCtx } from "./opened-from";
import { createLineBreaksPlugin } from "./markdown/line-breaks-plugin";

/**
 * The Markdown the editor reads and draws, in load order: CommonMark and
 * GFM, front matter, raw HTML, links and embeds, inline marks, maths,
 * tasks, code, tables and diagrams.
 */
export function withEditorSyntax(editor: Editor, env: CoreEnv): Editor {
  const { settings, docPath, editing } = env;
  const singleTilde = settings.current.singleTilde;
  const tildes = { singleTilde: singleTilde === "strikethrough" };
  return (
    editor
      // Commonmark/GFM with bold/italic/strike marks stripped: those are nodes.
      .use(commonmarkWithoutMarks)
      .use(editing(headingInputRule))
      .use(editing(ruleInputRule))
      .use(editing(orderedListInputRule))
      .use(headingIdsOnParse)
      .use(headingIdPlugin)
      // `[TOC]`: its Enter ahead of the block keys.
      .use(remarkTocPlugin)
      .use(tocSchema)
      .use(
        createTocPlugin(() => {
          const t = resolveStrings(settings.current.language);
          return { label: t.tocLabel, empty: t.tocEmpty };
        }),
      )
      .use(createHeadingFoldPlugin(() => docPath.current))
      // Ahead of gfm's table keys.
      .use(editing(tableEdgeArrowPlugin))
      .use(editing([tableKeys, tableRowPaste, clickBelowEnd]))
      .use(gfmWithoutStrikethrough)
      .use(unalignedTableCells)

      // Before anything else can misread its "---" lines as setext headings.
      .use(remarkFrontmatterPlugin)
      .use(frontmatterSchema)

      // Raw HTML parses to real text so it stays editable; common tags render
      // while the cursor is elsewhere.
      .use(rawHtmlSchema)
      // A document type's own syntax (MDX's imports, {expressions}, JSX),
      // read as raw source before anything else takes its text apart.
      .use(createRemarkVerbatim(keepFor(docPath.current)))
      .use(remarkHtmlImages)
      .use(createRawHtmlPreviewPlugin({ docPath: () => docPath.current }))
      .use(htmlAlignPlugin)
      .use(brToHardbreakPlugin)
      .use(
        createLineBreaksPlugin({
          setting: () => settings.current.singleNewline,
          docPath: () => docPath.current,
        }),
      )
      .use(remarkTableCellBreaks)

      .use(remarkReferenceLinksPlugin)
      .use(linkDefinitionSchema)
      .use(remarkLinkSourcePlugin)
      .use(linkSchema)

      .use(remarkObsidianEmbedPlugin)
      .use(obsidianEmbedSchema)
      .use(editing(obsidianEmbedInputRule))
      .use(remarkWikilinkPlugin)
      .use(wikilinkSchema)
      .use(editing(wikilinkInputRule))
      .use(wikilinkRevealPlugin)
      .use(createMissingLinksPlugin(() => docPath.current))
      .use(
        createEmbedsPlugin(
          () => docPath.current,
          () => settings.current,
        ),
      )

      .use(
        createGithubAlertPlugin((type) => {
          const t = resolveStrings(settings.current.language);
          return {
            NOTE: t.alertNote,
            TIP: t.alertTip,
            IMPORTANT: t.alertImportant,
            WARNING: t.alertWarning,
            CAUTION: t.alertCaution,
          }[type];
        }),
      )

      .use(inlineSyntaxPlugin)

      // CommonMark's flanking rules reject "**" next to CJK punctuation, which
      // would break reopening bold made here. Parse side only.
      .use($remark("remark-cjk-friendly", () => remarkCjkFriendly))
      // `~text~` reads as the setting says, fixed for this editor's life:
      // a change remounts the documents (DocumentViews). `~~text~~` always
      // strikes out.
      .use(singleTildeCtx)
      .config((ctx) => {
        // `update`: markdown-output sets the table options there too.
        ctx.update(remarkGFMPlugin.options.key, (options) => ({
          ...options,
          ...tildes,
        }));
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          singleTilde,
        }));
        ctx.set(singleTildeCtx.key, singleTilde);
      })
      .use(
        $remark(
          "remark-cjk-friendly-gfm-strikethrough",
          () => remarkCjkFriendlyGfmStrikethrough,
          tildes,
        ),
      )

      // Bold/italic/strikethrough/highlight/sub- and superscript/inline code as nodes with
      // synthesized, Typora-style delimiters.
      .use(remarkHighlightPlugin)
      .use(remarkScriptsPlugin(singleTilde))
      .use(remarkStrikethroughTildesPlugin)
      .use(remarkEmphasisUnderscoresPlugin)
      .use(mdSpanSchema)
      .use(mdCodeSpanSchema)
      .use(mdSpanClipboardPlugin)
      .use(
        createMdSpanAutopairPlugin({
          autoClose: () => settings.current.autoCloseMarks,
          singleTilde: () => singleTilde,
        }),
      )
      .use(
        editing(
          createBracketAutopairPlugin({
            enabled: () => settings.current.autoCloseBrackets,
          }),
        ),
      )
      .use(editing(formatShortcutPlugin))
      .use(editing(selectAllKeyPlugin))
      .use(editing(enclosurePlugin))
      .use(
        createColorSwatchPlugin({
          mode: () => settings.current.colorSwatches,
        }),
      )

      .use(emojiShortcodePlugin)

      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathBlockSchema)
      .use(editing(mathInlineInputRule))
      .use(editing(mathAutopairPlugin))
      .use(
        createMathPreviewPlugin({ enabled: () => settings.current.enableMath }),
      )

      .use(headingMarkerPlugin)
      .use(remarkEmptyTaskItems)
      .use(taskListClickPlugin)
      .use(listTallLinePlugin)
      .use(editing(cjkTaskInputPlugin))
      .use(syntaxHighlightPlugin)
      .use(
        createCodeBlockView(() => {
          const t = resolveStrings(settings.current.language);
          return {
            copy: t.codeBlockCopy,
            copied: t.codeBlockCopied,
            selectAll: t.selectAll,
            language: t.codeBlockLanguage,
            languageSearch: t.codeBlockLanguageSearch,
          };
        }),
      )
      .use(
        createCodeLineNumbersPlugin({
          enabled: () => settings.current.codeLineNumbers,
        }),
      )
      .use(createTableView(() => resolveStrings(settings.current.language)))
      .use(tableCaretPlugin)
      .use(editing(tableGrowth))
      .use(keyboardCaretPlugin)
      // Before the resize plugin: its press holds every column first.
      .use(editing(tableColumnFreeze))
      .use(editing(tableColumnResizing))
      .use(
        createMermaidPreviewPlugin({
          enabled: () => settings.current.enableMermaid,
          engine: () => settings.current.diagramEngine,
          path: () => docPath.current,
        }),
      )
  );
}
