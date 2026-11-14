import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { cachedDocument } from "../../editor/markdown/doc-markdown";
import {
  decorate,
  hasDecorationProviders,
  markUrl,
  onDecorationProviders,
  type PluginDecoration,
} from "../../plugins/contributions/decorations";
import "./plugin-decorations.css";
import { metaDecorations } from "../../editor/meta-decorations";
import { isFollowClick } from "../../editor/markdown/link-click-plugin";
import { editorExtensions } from "../../editor/extension-points";
import { links } from "../../platform/ipc";

const key = new PluginKey<DecorationSet>("plugin-decorations");
/** How long the document (or its scrolling) rests before plugins are
 *  asked again. */
const ASK_MS = 400;
/** Blocks either side of those in sight that are asked about too, so a
 *  short scroll finds them marked already. */
const AROUND = 10;

/**
 * Marks plugins put on the text: the blocks in sight go to each plugin once
 * the document rests, and their answers are drawn. Nothing runs while no
 * plugin marks.
 */
export const pluginDecorations = $prose((ctx) => {
  return new Plugin<DecorationSet>({
    key,
    state: metaDecorations(key),
    props: {
      decorations: (state) => key.getState(state),
      // A mark that links is followed as a link is: Cmd/Ctrl+click, the
      // caret left where it was.
      handleDOMEvents: {
        mousedown: (view, event) => !!linkedMark(view, event),
        click(view, event) {
          const url = linkedMark(view, event);
          if (!url) return false;
          event.preventDefault();
          if (!editorExtensions().openLink(url)) void links.openWebLink(url);
          return true;
        },
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let asked = 0;
      const ask = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void run(), ASK_MS);
      };
      const run = async () => {
        const turn = ++asked;
        if (!hasDecorationProviders()) {
          if (key.getState(view.state) !== DecorationSet.empty)
            view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty));
          return;
        }
        const doc = view.state.doc;
        const all = cachedDocument(ctx, doc).blocks;
        const [first, last] = inSight(view);
        const sent = all.slice(
          Math.max(0, first - AROUND),
          Math.min(all.length, last + AROUND + 1),
        );
        const marks = await decorate(sent, all);
        // Asked again meanwhile, or the text moved on: that answer wins.
        if (turn !== asked || view.isDestroyed) return;
        if (view.state.doc !== doc) {
          ask();
          return;
        }
        const starts: number[] = [];
        doc.forEach((_node, pos) => starts.push(pos));
        const index = new Map(all.map((b, i) => [b.id, i]));
        const out: Decoration[] = [];
        for (const mark of marks) {
          const i = index.get(mark.block);
          if (i === undefined) continue;
          out.push(...drawMark(doc.child(i), starts[i], mark));
        }
        view.dispatch(
          view.state.tr.setMeta(key, DecorationSet.create(doc, out)),
        );
      };
      // The view is made before it is in the page: its scroller is found
      // as scrolls come.
      const scrolled = (e: Event) => {
        if (e.target instanceof Node && e.target.contains(view.dom)) ask();
      };
      document.addEventListener("scroll", scrolled, {
        capture: true,
        passive: true,
      });
      const stop = onDecorationProviders(ask);
      ask();
      return {
        update(_view, prevState) {
          if (prevState.doc !== view.state.doc && hasDecorationProviders())
            ask();
        },
        destroy() {
          clearTimeout(timer);
          stop();
          document.removeEventListener("scroll", scrolled, { capture: true });
        },
      };
    },
  });
});

/** The link of the plugin mark a Cmd/Ctrl+click is on, or null. */
function linkedMark(view: EditorView, event: MouseEvent): string | null {
  if (!isFollowClick(event)) return null;
  const at = (event.target as Element | null)?.closest?.("[data-plugin-url]");
  if (!at || !view.dom.contains(at)) return null;
  event.preventDefault();
  return at.getAttribute("data-plugin-url");
}

/** The first and last top-level block in sight. */
export function inSight(view: EditorView): [number, number] {
  const count = view.state.doc.childCount;
  const scroller = view.dom.closest(".editor-scroll");
  if (!scroller) return [0, count - 1];
  const box = scroller.getBoundingClientRect();
  const left = view.dom.getBoundingClientRect().left + 24;
  const at = (top: number) => {
    const found = view.posAtCoords({ left, top });
    return found
      ? view.state.doc
          .resolve(Math.min(found.pos, view.state.doc.content.size))
          .index(0)
      : null;
  };
  return [at(box.top + 1) ?? 0, at(box.bottom - 1) ?? count - 1];
}

/** One mark on the block at `pos`: on its `anchor` words if they are in
 *  it, else on all its text. */
function drawMark(
  block: ProseNode,
  pos: number,
  mark: PluginDecoration & { plugin: string },
): Decoration[] {
  const [from, to] = (mark.anchor && anchorIn(block, pos, mark.anchor)) || [
    pos + 1,
    pos + block.nodeSize - 1,
  ];
  if (to <= from) return [];
  const tone = mark.tone ?? "accent";
  const attrs: Record<string, string> = {
    class: `plugin-mark plugin-mark-${mark.style} plugin-tone-${tone}`,
    "data-plugin": mark.plugin,
  };
  if (mark.tooltip) attrs.title = mark.tooltip;
  const url = markUrl(mark.url);
  if (url) {
    attrs["data-plugin-url"] = url;
    attrs.class += " plugin-mark-link";
  }
  // An export keeps neither.
  if (mark.style !== "badge")
    return [Decoration.inline(from, to, { ...attrs, "data-editor-mark": "" })];
  return [
    Decoration.widget(
      mark.before ? from : to,
      () => {
        const badge = document.createElement("span");
        badge.className = mark.before
          ? `${attrs.class} plugin-mark-badge-before`
          : attrs.class;
        badge.dataset.plugin = mark.plugin;
        badge.dataset.editorChrome = "";
        badge.textContent = mark.text ?? "";
        if (mark.tooltip) badge.title = mark.tooltip;
        return badge;
      },
      {
        side: mark.before ? -1 : 1,
        key: `${mark.plugin}:${mark.block}:${mark.text ?? ""}:${tone}:${mark.before ? "<" : ">"}`,
      },
    ),
  ];
}

/** Where `anchor` first is in one of the block's runs of text. */
function anchorIn(
  block: ProseNode,
  pos: number,
  anchor: string,
): [number, number] | null {
  let found: [number, number] | null = null;
  block.descendants((node, at) => {
    if (found) return false;
    const i = node.isText ? (node.text ?? "").indexOf(anchor) : -1;
    if (i >= 0) {
      const from = pos + 1 + at + i;
      found = [from, from + anchor.length];
    }
    return !node.isText;
  });
  return found;
}
