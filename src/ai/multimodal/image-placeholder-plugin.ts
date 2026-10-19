import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import "./image-placeholder.css";

/**
 * Where an image is being generated: a shimmering frame, shaped like the
 * requested picture, sits under its anchor paragraph until the job ends.
 * A widget decoration, not content - the document (and its revision, which
 * the insertion checks) is untouched, and the frame moves with edits above.
 */
export interface ImagePlaceholder {
  id: string;
  /** Position after the anchor block. */
  pos: number;
  /** Width / height of the requested size. */
  ratio: number;
  label: string;
  queued: boolean;
  /** Stable across phases (refining → queued → running) of one picture. */
  anchor: string;
}

/** Frames already on screen: a phase change re-creates the widget, which
 *  must neither replay its entrance nor restart the shimmer. */
const shown = new Set<string>();
const SHIMMER_MS = 2400;

export const imagePlaceholderKey = new PluginKey<DecorationSet>(
  "image-placeholder",
);

function frame(placeholder: ImagePlaceholder): HTMLElement {
  const dom = document.createElement("div");
  dom.className = `image-placeholder${placeholder.queued ? " is-queued" : ""}`;
  dom.contentEditable = "false";
  dom.setAttribute("role", "status");
  dom.style.setProperty("--placeholder-ratio", String(placeholder.ratio));
  if (shown.has(placeholder.anchor)) dom.classList.add("is-continuing");
  shown.add(placeholder.anchor);
  // One shared clock: every frame's shimmer is in the same phase it would
  // have been in had it never been re-created.
  dom.style.setProperty("--placeholder-phase", `-${Date.now() % SHIMMER_MS}ms`);
  const canvas = document.createElement("div");
  canvas.className = "image-placeholder-canvas";
  for (let i = 0; i < 3; i++) {
    const blob = document.createElement("span");
    blob.className = "image-placeholder-blob";
    canvas.append(blob);
  }
  const caption = document.createElement("div");
  caption.className = "image-placeholder-caption";
  const spinner = document.createElement("span");
  spinner.className = "image-placeholder-spinner";
  const label = document.createElement("span");
  label.textContent = placeholder.label;
  caption.append(spinner, label);
  dom.append(canvas, caption);
  return dom;
}

export const imagePlaceholderPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: imagePlaceholderKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
          const requested = tr.getMeta(imagePlaceholderKey) as
            ImagePlaceholder[] | undefined;
          if (requested) {
            const anchors = new Set(requested.map((p) => p.anchor));
            for (const anchor of shown)
              if (!anchors.has(anchor)) shown.delete(anchor);
          }
          if (requested)
            return DecorationSet.create(
              tr.doc,
              requested
                .filter((p) => p.pos >= 0 && p.pos <= tr.doc.content.size)
                .map((p) =>
                  Decoration.widget(p.pos, () => frame(p), {
                    // Same key while only the position moves: no re-mount,
                    // so the shimmer does not restart on every refresh.
                    key: `${p.id}:${p.queued ? "q" : "r"}:${p.label}`,
                    side: 1,
                    ignoreSelection: true,
                  }),
                ),
            );
          return tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous;
        },
      },
      props: {
        decorations: (state) => imagePlaceholderKey.getState(state),
      },
    }),
);
