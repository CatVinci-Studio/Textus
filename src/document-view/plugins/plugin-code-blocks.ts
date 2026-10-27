import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Ctx } from "@milkdown/kit/ctx";
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { cachedDocument } from "../../ai/doc-markdown";
import { drawWhenVisible } from "../../editor/draw-when-visible";
import { currentStrings } from "../../i18n/current";
import {
  codeBlockPlugin,
  hasCodeBlockLanguages,
  onCodeBlockLanguages,
  parseFenceMeta,
} from "../../plugins/contributions/code-blocks";
import type { CodeBlockSeen } from "../../plugins/manager";
import { PluginCodeBlock } from "../../plugins/views/plugin-views";
import { webviewPicture } from "../../plugins/views/webviews";
import { setDrawnBlocks } from "../../export/drawn-blocks";
import "./plugin-code-blocks.css";

const key = new PluginKey<DecorationSet>("plugin-code-blocks");
const BLOCK_CLASS = "plugin-code-block";
const HIDDEN_SOURCE_CLASS = "plugin-code-source-hidden";
/** How long an export waits for a drawing just made to have its page. */
const PAGE_WAIT_MS = 5000;
/** How long typing pauses before a drawn block is told its new source. */
const TELL_MS = 300;

/** A drawn block's widget, while it is in the document. */
interface Drawn {
  root: Root;
  render: () => void;
}

/**
 * Code blocks plugins draw: the plugin's page below the fenced block, made
 * once in sight. The source hides while the caret is elsewhere. A widget is
 * keyed by language and index, not source, so typing tells the plugin the
 * new source instead of remaking the page.
 */
export function pluginCodeBlocks(docPath: { readonly current: string | null }) {
  setDrawnBlocks(DRAWN_BLOCKS);
  return $prose((ctx) => {
    const drawn = new Map<string, Drawn>();

    function decorations(state: EditorState): DecorationSet {
      if (!hasCodeBlockLanguages()) return DecorationSet.empty;
      const { from, to } = state.selection;
      const seen = new Map<string, number>();
      const out: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") return true;
        const language = String(node.attrs.language ?? "").toLowerCase();
        const plugin = language && codeBlockPlugin(language);
        if (!plugin) return false;
        const n = (seen.get(language) ?? 0) + 1;
        seen.set(language, n);
        const end = pos + node.nodeSize;
        if (from < pos || to > end)
          out.push(Decoration.node(pos, end, { class: HIDDEN_SOURCE_CLASS }));
        const widget = `${plugin}:${language}:${n}`;
        out.push(
          Decoration.widget(
            end,
            (view, getPos) => draw(view, getPos, plugin, language, widget),
            {
              side: 1,
              key: widget,
              destroy: () => {
                const gone = drawn.get(widget);
                drawn.delete(widget);
                // Not while ProseMirror is drawing: React unmounts on its
                // own turn.
                if (gone) queueMicrotask(() => gone.root.unmount());
              },
            },
          ),
        );
        return false;
      });
      return DecorationSet.create(state.doc, out);
    }

    function draw(
      view: EditorView,
      getPos: () => number | undefined,
      plugin: string,
      language: string,
      widget: string,
    ): HTMLElement {
      const el = document.createElement("div");
      el.className = BLOCK_CLASS;
      el.dataset.language = language;
      el.contentEditable = "false";
      el.append(editButton(view, getPos));
      const holder = document.createElement("div");
      el.append(holder);
      drawWhenVisible(el, view.dom, () => {
        const root = createRoot(holder);
        const render = () => {
          const seen = blockAt(ctx, view, getPos, language);
          if (!seen) return;
          root.render(
            createElement(PluginCodeBlock, {
              plugin,
              widget,
              seen,
              setSource: (source: string) => setSource(view, getPos, source),
            }),
          );
        };
        drawn.set(widget, { root, render });
        render();
      });
      return el;
    }

    // The block's source as the plugin sees it, as typing pauses.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tell = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const block of drawn.values()) block.render();
      }, TELL_MS);
    };

    function blockAt(
      ctx: Ctx,
      view: EditorView,
      getPos: () => number | undefined,
      language: string,
    ): CodeBlockSeen | null {
      const end = getPos();
      if (end === undefined) return null;
      const doc = view.state.doc;
      const node = doc.resolve(end).nodeBefore;
      if (node?.type.name !== "code_block") return null;
      const top = doc.resolve(end - node.nodeSize).index(0);
      return {
        language,
        source: node.textContent,
        meta: parseFenceMeta(String(node.attrs.meta ?? "")),
        path: docPath.current,
        block: cachedDocument(ctx, doc).blocks[top]?.id ?? "",
      };
    }

    return new Plugin<DecorationSet>({
      key,
      state: {
        init: (_config, state) => decorations(state),
        apply(tr, prev, _old, state) {
          if (tr.docChanged || tr.selectionSet || tr.getMeta(key))
            return decorations(state);
          return prev;
        },
      },
      props: {
        decorations: (state) => key.getState(state),
      },
      view(view) {
        // A plugin turned on or off: its blocks drawn, or back to source.
        const stop = onCodeBlockLanguages(() =>
          view.dispatch(view.state.tr.setMeta(key, true)),
        );
        return {
          update(_view, prevState) {
            if (drawn.size && !prevState.doc.eq(view.state.doc)) tell();
          },
          destroy() {
            stop();
            clearTimeout(timer);
          },
        };
      },
    });
  });
}

/** CodeBlock.setSource: the block's text, as one undo step. */
function setSource(
  view: EditorView,
  getPos: () => number | undefined,
  source: string,
): boolean {
  const end = getPos();
  if (end === undefined) return false;
  const node: ProseNode | null | undefined =
    view.state.doc.resolve(end).nodeBefore;
  if (node?.type.name !== "code_block") return false;
  const start = end - node.nodeSize;
  view.dispatch(
    view.state.tr.replaceWith(
      start + 1,
      end - 1,
      source ? view.state.schema.text(source) : Fragment.empty,
    ),
  );
  return true;
}

/** The drawing's corner button: the caret into its source. */
function editButton(
  view: EditorView,
  getPos: () => number | undefined,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "plugin-code-edit";
  const label = currentStrings().codeBlockEditSource;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = "</>";
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const end = getPos();
    const node =
      end === undefined ? null : view.state.doc.resolve(end).nodeBefore;
    if (end === undefined || node?.type.name !== "code_block") return;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, end - node.nodeSize + 1),
      ),
    );
    view.focus();
  });
  return button;
}

/** An export's way to the drawings' pictures: each asks its plugin's page. */
const DRAWN_BLOCKS = {
  selector: `.${BLOCK_CLASS}`,
  hiddenSource: HIDDEN_SOURCE_CLASS,
  language: (el: HTMLElement) => el.dataset.language ?? "",
  async picture(el: HTMLElement, theme: "light" | "dark") {
    const page = await pageIn(el);
    return page ? webviewPicture(page, theme) : null;
  },
};

/** The webview drawn in `el`: there once its plugin has made it. */
function pageIn(el: HTMLElement): Promise<string | null> {
  const find = () =>
    el.querySelector<HTMLElement>("[data-webview-id]")?.dataset.webviewId ??
    null;
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(id);
    };
    const observer = new MutationObserver(() => {
      const id = find();
      if (id) done(id);
    });
    observer.observe(el, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), PAGE_WAIT_MS);
  });
}
