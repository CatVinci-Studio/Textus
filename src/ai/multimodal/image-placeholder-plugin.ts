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
  /** Shown in the frame: the prompt awaiting approval, or being painted. */
  prompt?: string;
  /** Buttons in the frame; handlers live in `placeholderActions`. */
  actions?: { id: string; label: string; primary?: boolean }[];
  /** The frame is waiting for the user (approve or adjust the prompt). */
  review?: boolean;
  /** Model and size, as the job cards show them. */
  meta?: string;
  /** The prompt is being adjusted in place: the card holds an empty
   *  container the editor renders its conversation into (PromptRefiner). */
  editing?: boolean;
}

/** The current handlers behind a frame's buttons, by placeholder id. The
 *  widget's DOM outlives renders, so it looks them up at click time. */
export const placeholderActions = new Map<string, Record<string, () => void>>();

/** Frames already on screen: a phase change re-creates the widget, which
 *  must neither replay its entrance nor restart the shimmer. */
const shown = new Set<string>();
const SHIMMER_MS = 2400;

export const imagePlaceholderKey = new PluginKey<DecorationSet>(
  "image-placeholder",
);

/** The frame, laid out like the image job cards (ImageTools.tsx): a
 *  thumbnail where the picture will be, then its status, the prompt it is
 *  made from, the paragraph it illustrates and what can be done. */
function frame(placeholder: ImagePlaceholder): HTMLElement {
  const el = (tag: string, className: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dom = el(
    "div",
    `image-placeholder${placeholder.queued ? " is-queued" : ""}${placeholder.review ? " is-review" : ""}`,
  );
  dom.contentEditable = "false";
  dom.setAttribute("role", "status");
  if (shown.has(placeholder.anchor)) dom.classList.add("is-continuing");
  shown.add(placeholder.anchor);
  // One shared clock: every frame's shimmer is in the same phase it would
  // have been in had it never been re-created.
  dom.style.setProperty("--placeholder-phase", `-${Date.now() % SHIMMER_MS}ms`);

  const thumb = el("div", "image-placeholder-thumb");
  thumb.style.setProperty("--placeholder-ratio", String(placeholder.ratio));
  for (let i = 0; i < 3; i++)
    thumb.append(el("span", "image-placeholder-blob"));

  const body = el("div", "image-placeholder-body");
  const head = el("div", "image-placeholder-head");
  const status = el(
    "span",
    `image-placeholder-status${placeholder.review ? " is-review" : ""}`,
  );
  status.append(el("span", "image-placeholder-dot"), placeholder.label);
  head.append(status);
  if (placeholder.meta)
    head.append(el("span", "image-placeholder-meta", placeholder.meta));
  body.append(head);
  if (placeholder.editing) {
    const host = el("div", "image-placeholder-editor");
    host.dataset.placeholderEditor = placeholder.id;
    body.append(host);
    dom.classList.add("is-editing");
    dom.append(thumb, body);
    return dom;
  }
  if (placeholder.prompt)
    body.append(el("p", "image-placeholder-prompt", placeholder.prompt));
  else {
    // Still being written: lines where the prompt will be.
    const lines = el("div", "image-placeholder-lines");
    for (let i = 0; i < 3; i++) lines.append(el("span", ""));
    body.append(lines);
  }
  body.append(el("p", "image-placeholder-anchor", `↳ ${placeholder.anchor}`));
  if (placeholder.actions?.length) {
    const actions = el("div", "image-placeholder-actions");
    for (const action of placeholder.actions) {
      const button = el(
        "button",
        action.primary ? "is-primary" : "",
        action.label,
      ) as HTMLButtonElement;
      button.type = "button";
      // Keep the editor's selection and focus where they are.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        placeholderActions.get(placeholder.id)?.[action.id]?.();
      });
      actions.append(button);
    }
    body.append(actions);
  }
  dom.append(thumb, body);
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
                    key: `${p.id}:${p.queued ? "q" : "r"}:${p.label}:${p.prompt ?? ""}:${(p.actions ?? []).map((a) => a.id).join()}:${p.editing ? "e" : ""}`,
                    side: 1,
                    ignoreSelection: true,
                    // The frame's buttons are ours, not the editor's.
                    stopEvent: () => true,
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
