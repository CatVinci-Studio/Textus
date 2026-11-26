import { type Editor, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { orderedListAttr } from "@milkdown/kit/preset/commonmark";
import { openWith } from "./opened-from";
import type { TabLeft } from "./tab-left";
import { installProseMirrorSpeedups } from "./prosemirror-speedups";
import { linuxImeEnterPlugin } from "./keys/linux-ime-enter-plugin";
import { iosEnterBeforeBlockPlugin } from "./keys/ios-enter-before-block-plugin";
import { compositionPruneGuardPlugin } from "./keys/composition-prune-guard-plugin";
import { configureMarkdownOutput } from "./markdown/markdown-output";
import { openedParseRecorder } from "./markdown/source-preserving";
import { macNavigationPlugin } from "./keys/mac-navigation-plugin";
import { editorExtensions } from "./extension-points";
import { noRevealPlugin } from "./pointer-hold";
import { pointerPlugins } from "./pointer-plugins";
import { createBlockHandlesPlugin } from "./blocks/block-handles-plugin";
import { scrollOptions } from "./editor-scroll";
import { createCompletionPlugin } from "./completion/completion-plugin";
import { addEmojiCompletion } from "./emoji/emoji-completion";
import { createImagePlugin } from "./images/image-plugin";
import { withLazyBlockViews } from "./lazy/lazy-blocks-editor";
import { readOnlyStatePlugin } from "./read-only-plugin";
import { resolveStrings } from "../i18n/strings";
import type { Settings } from "../prefs/SettingsContext";
import type { CoreEnv } from "./editor-core-env";
import { withEditorSyntax } from "./editor-core-syntax";
import { withEditorInput } from "./editor-core-input";
// Long documents: ProseMirror lookups that were linear made logarithmic.
installProseMirrorSpeedups();

/** Where the editor mounts and what it opens with, plus the DOM details the
 *  stylesheets rely on. `label` is read on every update, so a language
 *  switch reaches it. */
export function configureEditorRoot(
  ctx: Ctx,
  root: HTMLElement,
  initialValue: string,
  label: () => string,
  /** What the tab's last editor left: this one opens as that was. */
  from: TabLeft | null = null,
): void {
  ctx.set(rootCtx, root);
  openWith(ctx, initialValue, from);
  // Typora-compatible themes style their content under `#write`.
  ctx.set(
    editorViewOptionsCtx,
    withLazyBlockViews(ctx, {
      ...scrollOptions(root),
      attributes: () => ({
        id: "write",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label(),
      }),
    }),
  );
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
    /** Only read, every syntax drawn (the split view's preview). */
    preview?: boolean;
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
         *  this plugin takes image pastes. */
        noDiskImages: MilkdownPlugin;
      }
  ),
): Editor {
  const { settings, docPath } = options;
  const disk = !("noDiskImages" in options);
  // Only for writing: a preview, read and drawn, goes without them.
  const editing = (plugin: MilkdownPlugin | MilkdownPlugin[]) =>
    options.preview ? [] : plugin;
  const env: CoreEnv = {
    settings,
    docPath,
    editing,
    disk,
    images:
      "noDiskImages" in options
        ? options.noDiskImages
        : createImagePlugin({
            docPath: () => docPath.current,
            settings: () => settings.current,
            requestName: options.requestImageName,
            onError: options.onImagePasteError,
          }),
  };
  addEmojiCompletion(
    () => resolveStrings(settings.current.language).completionEmoji,
  );
  const firstKeys = editor
    // First: the plugins that read it are asked in order.
    .use(options.preview ? noRevealPlugin : [])
    // Read-only's state before every plugin that reads it applying the
    // same transaction (what shows as source); its keys come last.
    .use(readOnlyStatePlugin)
    .config(configureMarkdownOutput)
    // Which part of the file each block was read from, so a save writes the
    // blocks the user didn't touch as they were.
    .use(openedParseRecorder)
    // The open / panel takes the arrows, Enter, Tab and Esc first, even
    // from a plugin holding the keyboard (Vim's normal mode).
    .use(editing(createCompletionPlugin(() => docPath.current)))
    .use(editing(editorExtensions().keyInput))
    .use(editing(macNavigationPlugin))
    .use(editing(pointerPlugins(settings)))
    // A preview has no handles, but its fold carets come by a block's
    // start as the editor's do.
    .use(options.preview ? createBlockHandlesPlugin({ grip: false }) : [])
    .use(editing(linuxImeEnterPlugin))
    .use(editing(iosEnterBeforeBlockPlugin))
    .use(editing(compositionPruneGuardPlugin));
  return withEditorInput(withEditorSyntax(firstKeys, env), env);
}
