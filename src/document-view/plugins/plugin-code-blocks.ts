import type { Editor } from "@milkdown/kit/core";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Ctx } from "@milkdown/kit/ctx";
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  Selection,
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
import { drawWhileNear } from "../../editor/draw-when-visible";
import { currentStrings } from "../../i18n/current";
import {
  codeBlockFrameless,
  codeBlockPlugin,
  hasCodeBlockLanguages,
  onCodeBlockLanguages,
  parseFenceMeta,
} from "../../plugins/contributions/code-blocks";
import type { CodeBlockSeen } from "../../plugins/manager";
import { PluginCodeBlock } from "../../plugins/views/plugin-views";
import { webviewPicture } from "../../plugins/views/webviews";
import { setDrawnBlocks } from "../../export/drawn-blocks";
import { setEmbeddedBlocks } from "../../editor/embeds/embed-plugin-blocks";
import { drawPluginBlocksIn } from "./embedded-plugin-blocks";
import "./plugin-code-blocks.css";
import { markChangeSource } from "../../editor/change-source";
import { addBlockFold } from "../../editor/fold/block-fold";
import { setDrawnBlockActions } from "../../editor/drawn-block-actions";
import {
  pluginName,
  pluginsSnapshot,
} from "../../plugins/store/plugin-records";

/** What a folded block says it is: its plugin's name. */
function blockName(plugin: string): string {
  const record = pluginsSnapshot().records.find((r) => r.id === plugin);
  return record ? pluginName(record) : plugin;
}

/** The drawings, and the block whose source </> opened (its start), if any:
 *  only that one shows its source, until the caret leaves it. */
interface BlocksState {
  deco: DecorationSet;
  open: number | null;
}

const key = new PluginKey<BlocksState>("plugin-code-blocks");
const BLOCK_CLASS = "plugin-code-block";
const HIDDEN_SOURCE_CLASS = "plugin-code-source-hidden";
/** The block whose source shows: its drawing waits, hidden, as a diagram's
 *  does - one of the two at a time. */
const OPEN_SOURCE_CLASS = "plugin-code-source-open";
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
  setEmbeddedBlocks(drawPluginBlocksIn);
  return $prose((ctx) => {
    const drawn = new Map<string, Drawn>();

    function decorations(
      state: EditorState,
      open: number | null,
    ): DecorationSet {
      if (!hasCodeBlockLanguages()) return DecorationSet.empty;
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
        // The opened source's way back to the drawing, at its corner.
        if (pos === open)
          out.push(
            Decoration.widget(pos, (view) => doneButton(view), {
              side: -1,
              key: `done:${pos}`,
            }),
          );
        out.push(
          Decoration.node(pos, end, {
            class: pos === open ? OPEN_SOURCE_CLASS : HIDDEN_SOURCE_CLASS,
          }),
        );
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
      if (codeBlockFrameless(language))
        el.classList.add(`${BLOCK_CLASS}-plain`);
      el.dataset.language = language;
      el.contentEditable = "false";
      el.append(editButton(view, getPos));
      setDrawnBlockActions(el, {
        editSource: () => openSource(view, getPos),
        remove: () => removeBlock(view, getPos),
      });
      const holder = document.createElement("div");
      holder.className = "plugin-code-holder";
      el.append(holder);
      // Folded as Textus folds drawn blocks: by the document and its place.
      addBlockFold(
        el,
        blockName(plugin),
        `${docPath.current ?? ""}\n${widget}`,
      );
      // A plugin's frame is heavy: drawn near the screen, let go far from
      // it (its state kept through setWebviewState).
      drawWhileNear(
        el,
        view.dom,
        () => {
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
        },
        () => {
          drawn.get(widget)?.root.unmount();
          drawn.delete(widget);
        },
      );
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

    return new Plugin<BlocksState>({
      key,
      state: {
        init: (_config, state) => ({
          deco: decorations(state, null),
          open: null,
        }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(key) as
            { open?: number | null } | true | undefined;
          let open =
            meta && meta !== true && meta.open !== undefined
              ? meta.open
              : prev.open === null
                ? null
                : tr.mapping.map(prev.open);
          // The caret has left the opened block: its source hides again.
          if (open !== null && !holds(state, open)) open = null;
          if (tr.docChanged || meta || open !== prev.open)
            return { deco: decorations(state, open), open };
          return prev;
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.deco,
        handleKeyDown: (view, event) => {
          if (event.key !== "Escape") return false;
          if ((key.getState(view.state)?.open ?? null) === null) return false;
          closeSource(view);
          return true;
        },
      },
      // The caret never rests in a drawn block's hidden source: it steps
      // over it, the way it came. Only </> opens the source.
      appendTransaction(trs, old, state) {
        if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
        const open = key.getState(state)?.open ?? null;
        const { $head } = state.selection;
        for (let d = $head.depth; d > 0; d--) {
          const node = $head.node(d);
          if (node.type.name !== "code_block") continue;
          const start = $head.before(d);
          const language = String(node.attrs.language ?? "").toLowerCase();
          if (start === open || !language || !codeBlockPlugin(language))
            return null;
          const forward = old.selection.head <= start;
          const at = forward
            ? Selection.near(state.doc.resolve(start + node.nodeSize), 1)
            : Selection.near(state.doc.resolve(start), -1);
          return state.tr.setSelection(at);
        }
        return null;
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

/** Whether the selection is inside the code block that starts at `start`. */
function holds(state: EditorState, start: number): boolean {
  const node = state.doc.nodeAt(start);
  if (node?.type.name !== "code_block") return false;
  const { from, to } = state.selection;
  return from > start && to < start + node.nodeSize;
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
    markChangeSource(
      view.state.tr.replaceWith(
        start + 1,
        end - 1,
        source ? view.state.schema.text(source) : Fragment.empty,
      ),
      "plugin",
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
    openSource(view, getPos);
  });
  return button;
}

/** The code block a drawing (its widget at `getPos`) is drawn from. */
function blockBefore(
  view: EditorView,
  getPos: () => number | undefined,
): { start: number; end: number } | null {
  const end = getPos();
  const node =
    end === undefined ? null : view.state.doc.resolve(end).nodeBefore;
  if (end === undefined || node?.type.name !== "code_block") return null;
  return { start: end - node.nodeSize, end };
}

/** The caret into the drawing's source, which shows until it leaves. */
function openSource(view: EditorView, getPos: () => number | undefined) {
  const block = blockBefore(view, getPos);
  if (!block) return;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, block.start + 1))
      .setMeta(key, { open: block.start }),
  );
  view.focus();
}

/** The opened source hidden again, the caret just after its drawing. */
function closeSource(view: EditorView) {
  const open = key.getState(view.state)?.open ?? null;
  const node = open === null ? null : view.state.doc.nodeAt(open);
  if (open === null || !node) return;
  const after = view.state.doc.resolve(open + node.nodeSize);
  view.dispatch(
    view.state.tr
      .setSelection(Selection.near(after, 1))
      .setMeta(key, { open: null }),
  );
  view.focus();
}

/** The whole block - source and drawing - out of the document. */
function removeBlock(view: EditorView, getPos: () => number | undefined) {
  const block = blockBefore(view, getPos);
  if (block) view.dispatch(view.state.tr.delete(block.start, block.end));
}

/** The opened source's button back to its drawing (Esc does the same). */
function doneButton(view: EditorView): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-code-done-row";
  row.contentEditable = "false";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "plugin-code-done";
  button.textContent = currentStrings().codeBlockDone;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    closeSource(view);
  });
  row.append(button);
  return row;
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

/** Plugins' blocks drawn in another editor (the split view's preview). */
export const withPluginBlocks = (
  editor: Editor,
  docPath: { readonly current: string | null },
): Editor => editor.use(pluginCodeBlocks(docPath));
