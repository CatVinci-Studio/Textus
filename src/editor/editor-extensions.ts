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
import { editorInputPlugin } from "../plugins/editor-input";
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
import { tabExtendPlugin, tabStaysPlugin } from "./keys/tab-extend-plugin";
import {
  escapeTrailingBlockPlugin,
  tableEdgeArrowPlugin,
} from "./markdown/escape-trailing-block-plugin";
import { codeBlockIndentPlugin } from "./code/code-block-indent-plugin";
import { pasteMarkdownSourcePlugin } from "./markdown/paste-markdown-plugin";
import { imageInputRule, linkInputRule } from "./markdown/link-input-rule";
import { remarkLinkSourcePlugin } from "./markdown/link-source";
import { linkRevealPlugin, linkSourceSchema } from "./markdown/link-reveal";
import {
  footnoteInputRule,
  htmlTagInputRule,
} from "./markdown/source-input-rules";
import { pasteUrlPlugin } from "./markdown/paste-url";
import { createLinkClickPlugin } from "./markdown/link-click-plugin";
import { clipboardHistoryPlugin } from "../clipboard/history-plugin";
import { plainTextCopyPlugin } from "./markdown/plain-text-copy-plugin";
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

/** Where the editor mounts and what it opens with, plus the two DOM details
 *  the stylesheets rely on - shared by the app's editor and the browser
 *  playground's. Called from `Editor.make().config(...)`. `label` names
 *  the text box for a screen reader in the interface language; it is read
 *  on every update, so a language switch reaches it. */
export function configureEditorRoot(
  ctx: Ctx,
  root: HTMLElement,
  initialValue: string,
  label: () => string,
): void {
  ctx.set(rootCtx, root);
  ctx.set(defaultValueCtx, initialValue);
  // Typora-compatible themes style their content under `#write` - aliasing
  // it here lets most community Typora themes' CSS apply directly to our
  // content with no rewriting.
  ctx.set(editorViewOptionsCtx, {
    attributes: () => ({
      id: "write",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label(),
    }),
  });
  // A list starting somewhere other than 1 ("3. ") is the one thing the DOM
  // structure alone doesn't tell the counter that numbers ordered lists
  // (see .milkdown ol in milkdown-theme.css), so the node's `order` rides
  // along as a custom property. Minus one because counter-reset sets the
  // value BEFORE the first increment.
  ctx.set(orderedListAttr.key, (node) => {
    const order = (node.attrs.order as number) ?? 1;
    return order === 1 ? {} : { style: `--textus-ol-start: ${order - 1}` };
  });
}

/**
 * The Markdown editor itself, in load order: parsing and saving, the
 * Typora-style marks, math, diagrams, images, tables, keys and modes. The
 * AI features attach on top of this (ai/editor-plugins.ts), and
 * document-view/editor-extensions.ts puts the two together.
 *
 * `settings` and `docPath` are live refs (see useLatest): the chain is built
 * once at mount while several plugins follow the current values.
 */
export function withEditorCore(
  editor: Editor,
  options: {
    settings: { readonly current: Settings };
    docPath: { readonly current: string | null };
  } & (
    | {
        /** A pasted image failed to save to disk - the message to show in
         *  a native alert (localized, since this plugin has no i18n
         *  access). */
        onImagePasteError: () => string;
        requestImageName: (
          stem: string,
          extension: string,
        ) => Promise<string | null>;
      }
    | {
        /** No disk behind the page (the browser playground,
         *  src/playground/): pasted images aren't stored and no clipboard
         *  history is kept - this plugin takes image pastes instead. */
        noDiskImages: MilkdownPlugin;
      }
  ),
): Editor {
  const { settings, docPath } = options;
  const disk = !("noDiskImages" in options);
  return (
    editor
      // How saved markdown is written (markdown-output.ts).
      .config(configureMarkdownOutput)
      // Which part of the file each block was read from, so a save writes
      // the blocks the user didn't touch as they were (source-preserving.ts).
      .use(openedParseRecorder)
      .use(linksOnSpansSerializer)
      // A plugin holding the keyboard (Vim's normal mode) has its keys
      // before any of the editor's own handlers.
      .use(editorInputPlugin)
      .use(macNavigationPlugin)
      .use(linuxImeEnterPlugin)
      .use(compositionPruneGuardPlugin)
      // Markdown baseline: commonmark/GFM with bold/italic/strike marks
      // stripped - those are node-based below.
      .use(commonmarkWithoutMarks)
      .use(headingInputRule)
      .use(ruleInputRule)
      .use(orderedListInputRule)
      .use(headingIdsOnParse)
      .use(headingIdPlugin)
      // Ahead of gfm's table keys (escape-trailing-block-plugin.ts).
      .use(tableEdgeArrowPlugin)
      .use(gfmWithoutStrikethrough)

      // Leading "---\n...\n---" block, parsed before anything else gets a
      // chance to misread its "---" lines as setext headings.
      .use(remarkFrontmatterPlugin)
      .use(frontmatterSchema)

      // Raw HTML: parses to real text (replacing stock htmlSchema, excluded
      // in reduced-presets.ts) so it stays editable; a whitelist of common
      // tags renders while the cursor is elsewhere.
      .use(rawHtmlSchema)
      // An <img> tag is an image, sized by its width (images/image-html.ts).
      .use(remarkHtmlImages)
      .use(createRawHtmlPreviewPlugin({ docPath: () => docPath.current }))
      .use(brToHardbreakPlugin)
      .use(remarkTableCellBreaks)

      // Reference links, `[text][ref]`, and their `[ref]: url` definitions:
      // read as links, written back as references.
      .use(remarkReferenceLinksPlugin)
      .use(linkDefinitionSchema)
      // Each link's Markdown as written, shown and edited while the caret
      // is on the link (link-reveal.ts).
      .use(remarkLinkSourcePlugin)
      .use(linkSourceSchema)

      // Obsidian's ![[file]] embeds: kept as written, an image one shown as
      // the picture from the document's vault.
      .use(remarkObsidianEmbedPlugin)
      .use(obsidianEmbedSchema)
      .use(obsidianEmbedInputRule)
      // And its wikilinks, [[Note]]: kept as written, Ctrl/Cmd+click opens
      // the note.
      .use(remarkWikilinkPlugin)
      .use(wikilinkSchema)
      .use(wikilinkInputRule)
      .use(
        createObsidianEmbedPreviewPlugin({
          docPath: () => docPath.current,
          settings: () => settings.current,
        }),
      )

      // GitHub-style alerts: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING]
      // / [!CAUTION] blockquotes render as colored callouts with a badge.
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

      // CommonMark's emphasis flanking rules reject "**" next to CJK
      // punctuation (e.g. 话说**“你好”**了 stays literal), which would also
      // break reopening files whose bold was created here. This relaxes the
      // rules for CJK - parse side only; serialization is unchanged.
      .use($remark("remark-cjk-friendly", () => remarkCjkFriendly))
      .use(
        $remark(
          "remark-cjk-friendly-gfm-strikethrough",
          () => remarkCjkFriendlyGfmStrikethrough,
        ),
      )

      // Inline enclosures: bold/italic/strikethrough/highlight/inline code
      // as real nodes with synthesized, Typora-style delimiters.
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

      // Math: $/$$ enclosures sharing the same model, plus KaTeX rendering;
      // LaTeX's \(...\) / \[...\] are read and kept (latex-math-syntax.ts).
      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathBlockSchema)
      .use(mathInlineInputRule)
      .use(mathAutopairPlugin)
      .use(
        createMathPreviewPlugin({ enabled: () => settings.current.enableMath }),
      )

      // Block-level niceties.
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
            language: t.codeBlockLanguage,
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

      // Editing infrastructure. handlePaste props run in registration
      // order: images (binary, most specific) first, then a lone URL, then
      // markdown-source text, then milkdown's own clipboard plugin.
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
      .use(htmlTagInputRule)
      .use(footnoteInputRule)
      .use(pasteUrlPlugin)
      .use(pasteMarkdownSourcePlugin)
      .use(plainTextCopyPlugin)
      .use(clipboard)
      .use(disk ? clipboardHistoryPlugin : [])
      // Ctrl/Cmd+click follows a link. The playground leaves links to the
      // browser it runs in.
      .use(disk ? createLinkClickPlugin(() => docPath.current) : [])
      .use(listener)
      // Enter / Mod+Enter in tables, code blocks and quotes - ahead of the
      // other key handlers and the preset keymaps.
      .use(blockKeysPlugin)
      .use(tabExtendPlugin)
      .use(tabStaysPlugin)
      .use(escapeTrailingBlockPlugin)
      .use(codeBlockIndentPlugin)
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
