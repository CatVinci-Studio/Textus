import type { Editor } from "@milkdown/kit/core";
import { historyOpened, openedFromCtx } from "./opened-from";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener } from "./editor-listener";
import { blockKeysPlugin } from "./keys/block-keys-plugin";
import { listBackspacePlugin } from "./keys/list-backspace-plugin";
import { joinListsPlugin } from "./keys/join-lists-plugin";
import { blockJoinPlugin } from "./keys/block-join-plugin";
import { inlineSourcePlugin } from "./keys/inline-source-plugin";
import { tabExtendPlugin, tabStaysPlugin } from "./keys/tab-extend-plugin";
import { moveBlockPlugin } from "./keys/move-block-plugin";
import { escapeTrailingBlockPlugin } from "./markdown/escape-trailing-block-plugin";
import { pasteMarkdownSourcePlugin } from "./clipboard/paste-markdown-plugin";
import { imageInputRule, linkInputRule } from "./markdown/link-input-rule";
import { linkSettlePlugin } from "./markdown/link-settle";
import { createLinkRevealPlugin } from "./markdown/link-reveal";
import { linkNormalizePlugin } from "./markdown/link-normalize";
import {
  footnoteInputRule,
  htmlTagInputRule,
} from "./markdown/source-input-rules";
import { pasteUrlPlugin } from "./clipboard/paste-url";
import { pasteHookPlugin } from "./clipboard/paste-hook";
import { ownUndoStepPlugin } from "./clipboard/own-undo-step";
import { changeSourcePlugin } from "./change-source";
import { createLinkClickPlugin } from "./markdown/link-click-plugin";
import { createLinkHoverPlugin } from "./hover/link-hover-plugin";
import { copiedPlugin } from "../clipboard/copied-plugin";
import { copyTextPlugin } from "./clipboard/copy-text-plugin";
import { pastePlainTextKeyPlugin } from "./clipboard/paste-plain";
import { pictureCopyPlugin } from "./images/picture-clipboard";
import { createUndoFilePlugin } from "./undo-file";
import { createTypewriterPlugin } from "./modes/typewriter-plugin";
import { zenFocusPlugin } from "./modes/zen-focus-plugin";
import { createPlaceholderPlugin } from "./placeholder-plugin";
import { findReplacePlugin } from "./find/find-replace-plugin";
import { lazyBlocksPlugin } from "./lazy/lazy-blocks-editor";
import { readOnlyPlugin } from "./read-only-plugin";
import { resolveStrings } from "../i18n/strings";
import type { CoreEnv } from "./editor-core-env";

/**
 * Pasting, copying and the block keys, in load order: handlePaste props
 * run in registration order, and the block keys come after the inline ones,
 * ahead of the preset keymaps Milkdown adds last.
 */
export function withEditorInput(editor: Editor, env: CoreEnv): Editor {
  const { settings, docPath, editing } = env;
  return (
    editor
      // handlePaste props run in registration order: images first, then a lone
      // URL, then markdown source, then milkdown's own clipboard plugin.
      .use(openedFromCtx)
      .use(editing(historyOpened))
      .use(editing(env.disk ? createUndoFilePlugin(() => docPath.current) : []))
      .use(editing(ownUndoStepPlugin))
      .use(editing(changeSourcePlugin))
      .use(env.images)
      .use(editing(linkInputRule))
      .use(createLinkRevealPlugin(() => docPath.current))
      .use(editing(linkNormalizePlugin))
      .use(editing(imageInputRule))
      .use(editing(linkSettlePlugin))
      .use(editing(htmlTagInputRule))
      .use(editing(footnoteInputRule))
      .use(editing(pasteHookPlugin))
      .use(editing(pasteUrlPlugin))
      .use(editing(pasteMarkdownSourcePlugin))
      .use(editing(copyTextPlugin))
      .use(editing(pictureCopyPlugin))
      .use(editing(pastePlainTextKeyPlugin))
      .use(editing(clipboard))
      .use(editing(copiedPlugin))
      // The playground leaves links to the browser it runs in.
      .use(env.disk ? createLinkClickPlugin(() => docPath.current) : [])
      .use(env.disk ? createLinkHoverPlugin(() => docPath.current) : [])
      .use(listener)
      // The block keys: after the inline ones above (enclosures, autopairs,
      // headings, callouts), ahead of the preset keymaps, which Milkdown adds
      // last. The order is pinned in editor-extensions.test.ts.
      .use(editing(blockKeysPlugin))
      .use(editing(tabExtendPlugin))
      .use(editing(tabStaysPlugin))
      .use(editing(moveBlockPlugin))
      .use(editing(escapeTrailingBlockPlugin))
      .use(editing(listBackspacePlugin))
      .use(joinListsPlugin)
      .use(editing(blockJoinPlugin))
      .use(editing(inlineSourcePlugin))
      .use(editing(findReplacePlugin))
      // A long document's blocks out of sight are placeholders.
      .use(lazyBlocksPlugin)
      .use(readOnlyPlugin)
      .use(editing(zenFocusPlugin))
      .use(
        editing(
          createTypewriterPlugin({
            enabled: () => settings.current.typewriterMode,
          }),
        ),
      )
      .use(
        editing(
          createPlaceholderPlugin(
            () => resolveStrings(settings.current.language).emptyDocPlaceholder,
            () =>
              settings.current.emptyLineHint
                ? resolveStrings(settings.current.language).emptyLineHint
                : null,
          ),
        ),
      )
  );
}
