import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
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
import { drawGutter } from "./plugin-gutter";
import { askAtRest, answerRange } from "./rest-asking";

const key = new PluginKey<DecorationSet>("plugin-decorations");
/**
 * Marks plugins put on the text: the blocks in sight go to each plugin once
 * the document rests, and their answers are drawn. Nothing runs while no
 * plugin marks.
 */
export const pluginDecorations = (docPath: {
  readonly current: string | null;
}) =>
  $prose((ctx) => {
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
      view: (view) =>
        askAtRest(ctx, view, docPath, {
          key,
          active: hasDecorationProviders,
          subscribe: onDecorationProviders,
          ask: decorate,
          draw: drawMark,
        }),
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

/** One mark on the block at `pos`: on its `anchor` words if they are in
 *  it, else on all its text. */
function drawMark(
  block: ProseNode,
  pos: number,
  mark: PluginDecoration & { plugin: string },
): Decoration[] {
  if (mark.style === "gutter")
    return [drawGutter(block, pos, mark, mark.tone ?? "accent")];
  const [from, to] = answerRange(block, pos, mark.anchor);
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
    return [
      Decoration.inline(
        from,
        to,
        { ...attrs, "data-editor-mark": "" },
        { plugin: mark.plugin },
      ),
    ];
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
        plugin: mark.plugin,
        side: mark.before ? -1 : 1,
        key: `${mark.plugin}:${mark.block}:${mark.text ?? ""}:${tone}:${mark.before ? "<" : ">"}`,
      },
    ),
  ];
}
