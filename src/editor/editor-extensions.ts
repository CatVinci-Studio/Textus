import {
  type Editor,
  defaultValueCtx,
  editorViewOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { orderedListAttr } from "@milkdown/kit/preset/commonmark";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener } from "@milkdown/kit/plugin/listener";
import { $remark } from "@milkdown/kit/utils";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import {
  commonmarkWithoutMarks,
  gfmWithoutStrikethrough,
  headingInputRule,
  orderedListInputRule,
  ruleInputRule,
} from "./markdown/reduced-presets";
import {
  remarkFrontmatterPlugin,
  frontmatterSchema,
} from "./markdown/frontmatter-schema";
import { createGithubAlertPlugin } from "./markdown/github-alert-plugin";
import {
  headingIdPlugin,
  headingIdsOnParse,
} from "./markdown/heading-id-plugin";
import { rawHtmlSchema } from "./html/raw-html-schema";
import { remarkHtmlImages } from "./images/image-html";
import { createRawHtmlPreviewPlugin } from "./html/raw-html-preview-plugin";
import {
  brToHardbreakPlugin,
  remarkTableCellBreaks,
} from "./markdown/br-hardbreak-plugin";
import {
  remarkHighlightPlugin,
  remarkStrikethroughTildesPlugin,
  remarkEmphasisUnderscoresPlugin,
  mdSpanSchema,
  mdCodeSpanSchema,
  mdSpanClipboardPlugin,
} from "./marks/md-span-schema";
import { createMdSpanAutopairPlugin } from "./marks/md-span-autopair-plugin";
import { createColorSwatchPlugin } from "./marks/color-swatch-plugin";
import { createBracketAutopairPlugin } from "./keys/bracket-autopair-plugin";
import { formatShortcutPlugin } from "./keys/format-shortcut-plugin";
import { enclosurePlugin } from "./marks/enclosure";
import { linuxImeEnterPlugin } from "./keys/linux-ime-enter-plugin";
import { compositionPruneGuardPlugin } from "./keys/composition-prune-guard-plugin";
import {
  configureMarkdownOutput,
  linksOnSpansSerializer,
} from "./markdown/markdown-output";
import { openedParseRecorder } from "./markdown/source-preserving";
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
import { macNavigationPlugin } from "./keys/mac-navigation-plugin";
import { dragAutoscrollPlugin } from "./keys/drag-autoscroll-plugin";
import { editorInputPlugin } from "../plugins/contributions/editor-input";
import {
  cjkTaskInputPlugin,
  remarkEmptyTaskItems,
  taskListClickPlugin,
} from "./markdown/task-list-plugin";
import { syntaxHighlightPlugin } from "./code/syntax-highlight-plugin";
import { createCodeBlockView } from "./code/code-block-language-view";
import { createCodeLineNumbersPlugin } from "./code/code-line-numbers-plugin";
import { tableColumnResizing, tableHoverView } from "./tables/table-hover-view";
import { createMermaidPreviewPlugin } from "./mermaid-plugin";
import { blockKeysPlugin } from "./keys/block-keys-plugin";
import { blockJoinPlugin } from "./keys/block-join-plugin";
import { inlineSourcePlugin } from "./keys/inline-source-plugin";
import { tabExtendPlugin, tabStaysPlugin } from "./keys/tab-extend-plugin";
import {
  escapeTrailingBlockPlugin,
  tableEdgeArrowPlugin,
} from "./markdown/escape-trailing-block-plugin";
import { pasteMarkdownSourcePlugin } from "./markdown/paste-markdown-plugin";
import { imageInputRule, linkInputRule } from "./markdown/link-input-rule";
import { linkSettlePlugin } from "./markdown/link-settle";
import { remarkLinkSourcePlugin } from "./markdown/link-source";
import { linkRevealPlugin, linkSourceSchema } from "./markdown/link-reveal";
import {
  footnoteInputRule,
  htmlTagInputRule,
} from "./markdown/source-input-rules";
import { pasteUrlPlugin } from "./markdown/paste-url";
import { createLinkClickPlugin } from "./markdown/link-click-plugin";
import { createLinkHoverPlugin } from "./hover/link-hover-plugin";
import { createCompletionPlugin } from "./completion/completion-plugin";
import { clipboardHistoryPlugin } from "../clipboard/history-plugin";
import { copyTextPlugin } from "./markdown/copy-text-plugin";
import { pastePlainTextKeyPlugin } from "./markdown/paste-plain";
import { createImagePlugin } from "./images/image-plugin";
import {
  obsidianEmbedInputRule,
  obsidianEmbedSchema,
  remarkObsidianEmbedPlugin,
} from "./images/obsidian-embed";
import { createObsidianEmbedPreviewPlugin } from "./images/obsidian-embed-preview";
import { createTypewriterPlugin } from "./modes/typewriter-plugin";
import { zenFocusPlugin } from "./modes/zen-focus-plugin";
import { keyboardRevealPlugin } from "./keys/keyboard-reveal-plugin";
import { createPlaceholderPlugin } from "./placeholder-plugin";
import { findReplacePlugin } from "./find/find-replace-plugin";
import { resolveStrings } from "../i18n/strings";
import type { Settings } from "../settings/SettingsContext";

/** Where the editor mounts and what it opens with, plus the DOM details the
 *  stylesheets rely on. `label` is read on every update, so a language
 *  switch reaches it. */
export function configureEditorRoot(
  ctx: Ctx,
  root: HTMLElement,
  initialValue: string,
  label: () => string,
): void {
  ctx.set(rootCtx, root);
  ctx.set(defaultValueCtx, initialValue);
  // Typora-compatible themes style their content under `#write`.
  ctx.set(editorViewOptionsCtx, {
    attributes: () => ({
      id: "write",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label(),
    }),
  });
  // A list's start ("3. ") isn't in the DOM structure the CSS counter reads,
  // so it rides along as a custom property; minus one because counter-reset
  // sets the value before the first increment.
  ctx.set(orderedListAttr.key, (node) => {
    const order = (node.attrs.order as number) ?? 1;
    return order === 1 ? {} : { style: `--textus-ol-start: ${order - 1}` };
  });
}

/**
 * The Markdown editor itself, in load order. `settings` and `docPath` are
 * live refs: the chain is built once at mount.
 */
export function withEditorCore(
  editor: Editor,
  options: {
    settings: { readonly current: Settings };
    docPath: { readonly current: string | null };
  } & (
    | {
        /** A pasted image failed to save to disk: the localized message for a
         *  native alert. */
        onImagePasteError: () => string;
        requestImageName: (
          stem: string,
          extension: string,
        ) => Promise<string | null>;
      }
    | {
        /** No disk behind the page (the playground): pasted images aren't stored
         *  and no clipboard history is kept; this plugin takes image pastes. */
        noDiskImages: MilkdownPlugin;
      }
  ),
): Editor {
  const { settings, docPath } = options;
  const disk = !("noDiskImages" in options);
  return (
    editor
      .config(configureMarkdownOutput)
      // Which part of the file each block was read from, so a save writes the
      // blocks the user didn't touch as they were.
      .use(openedParseRecorder)
      .use(linksOnSpansSerializer)
      // A plugin holding the keyboard (Vim's normal mode) has its keys first.
      .use(editorInputPlugin)
      // A plugin's completions take Enter, Tab and the arrows while open.
      .use(createCompletionPlugin())
      .use(macNavigationPlugin)
      .use(dragAutoscrollPlugin)
      .use(linuxImeEnterPlugin)
      .use(compositionPruneGuardPlugin)
      // Commonmark/GFM with bold/italic/strike marks stripped: those are nodes.
      .use(commonmarkWithoutMarks)
      .use(headingInputRule)
      .use(ruleInputRule)
      .use(orderedListInputRule)
      .use(headingIdsOnParse)
      .use(headingIdPlugin)
      // Ahead of gfm's table keys.
      .use(tableEdgeArrowPlugin)
      .use(gfmWithoutStrikethrough)

      // Before anything else can misread its "---" lines as setext headings.
      .use(remarkFrontmatterPlugin)
      .use(frontmatterSchema)

      // Raw HTML parses to real text so it stays editable; common tags render
      // while the cursor is elsewhere.
      .use(rawHtmlSchema)
      .use(remarkHtmlImages)
      .use(createRawHtmlPreviewPlugin({ docPath: () => docPath.current }))
      .use(brToHardbreakPlugin)
      .use(remarkTableCellBreaks)

      .use(remarkReferenceLinksPlugin)
      .use(linkDefinitionSchema)
      .use(remarkLinkSourcePlugin)
      .use(linkSourceSchema)

      .use(remarkObsidianEmbedPlugin)
      .use(obsidianEmbedSchema)
      .use(obsidianEmbedInputRule)
      .use(remarkWikilinkPlugin)
      .use(wikilinkSchema)
      .use(wikilinkInputRule)
      .use(
        createObsidianEmbedPreviewPlugin({
          docPath: () => docPath.current,
          settings: () => settings.current,
        }),
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

      // CommonMark's flanking rules reject "**" next to CJK punctuation, which
      // would break reopening bold made here. Parse side only.
      .use($remark("remark-cjk-friendly", () => remarkCjkFriendly))
      .use(
        $remark(
          "remark-cjk-friendly-gfm-strikethrough",
          () => remarkCjkFriendlyGfmStrikethrough,
        ),
      )

      // Bold/italic/strikethrough/highlight/inline code as nodes with
      // synthesized, Typora-style delimiters.
      .use(remarkHighlightPlugin)
      .use(remarkStrikethroughTildesPlugin)
      .use(remarkEmphasisUnderscoresPlugin)
      .use(mdSpanSchema)
      .use(mdCodeSpanSchema)
      .use(mdSpanClipboardPlugin)
      .use(
        createMdSpanAutopairPlugin({
          autoClose: () => settings.current.autoCloseMarks,
        }),
      )
      .use(
        createBracketAutopairPlugin({
          enabled: () => settings.current.autoCloseBrackets,
        }),
      )
      .use(formatShortcutPlugin)
      .use(enclosurePlugin)
      .use(
        createColorSwatchPlugin({
          mode: () => settings.current.colorSwatches,
        }),
      )

      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathBlockSchema)
      .use(mathInlineInputRule)
      .use(mathAutopairPlugin)
      .use(
        createMathPreviewPlugin({ enabled: () => settings.current.enableMath }),
      )

      .use(headingMarkerPlugin)
      .use(remarkEmptyTaskItems)
      .use(taskListClickPlugin)
      .use(cjkTaskInputPlugin)
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
      .use(tableHoverView)
      .use(tableColumnResizing)
      .use(
        createMermaidPreviewPlugin({
          enabled: () => settings.current.enableMermaid,
          engine: () => settings.current.diagramEngine,
        }),
      )

      // handlePaste props run in registration order: images first, then a lone
      // URL, then markdown source, then milkdown's own clipboard plugin.
      .use(history)
      .use(
        "noDiskImages" in options
          ? options.noDiskImages
          : createImagePlugin({
              docPath: () => docPath.current,
              settings: () => settings.current,
              requestName: options.requestImageName,
              onError: options.onImagePasteError,
            }),
      )
      .use(linkInputRule)
      .use(linkRevealPlugin)
      .use(imageInputRule)
      .use(linkSettlePlugin)
      .use(htmlTagInputRule)
      .use(footnoteInputRule)
      .use(pasteUrlPlugin)
      .use(pasteMarkdownSourcePlugin)
      .use(copyTextPlugin)
      .use(pastePlainTextKeyPlugin)
      .use(clipboard)
      .use(disk ? clipboardHistoryPlugin : [])
      // The playground leaves links to the browser it runs in.
      .use(disk ? createLinkClickPlugin(() => docPath.current) : [])
      .use(disk ? createLinkHoverPlugin(() => docPath.current) : [])
      .use(listener)
      // Ahead of the other key handlers and the preset keymaps.
      .use(blockKeysPlugin)
      .use(tabExtendPlugin)
      .use(tabStaysPlugin)
      .use(escapeTrailingBlockPlugin)
      .use(blockJoinPlugin)
      .use(inlineSourcePlugin)
      .use(findReplacePlugin)
      .use(zenFocusPlugin)
      .use(keyboardRevealPlugin)
      .use(
        createTypewriterPlugin({
          enabled: () => settings.current.typewriterMode,
        }),
      )
      .use(
        createPlaceholderPlugin(
          () => resolveStrings(settings.current.language).emptyDocPlaceholder,
        ),
      )
  );
}
