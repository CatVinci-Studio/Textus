import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * Editing the words of a block of raw HTML where it is drawn: a click on its
 * text makes that text editable, and leaving it (or Enter) writes the new
 * words back into the source between the same tags. Tags and attributes are
 * never touched; Escape puts the words back. Only where every piece of text
 * drawn can be matched, in order, to the text in the source - otherwise a
 * click shows the source, as before.
 */

/** A run of text in the source between tags, trimmed: where it is, and
 *  what it reads as. */
interface Segment {
  from: number;
  to: number;
  text: string;
}

// Tags, comments, and the contents of elements whose text isn't drawn.
const NOT_TEXT_RE =
  /<!--[\s\S]*?-->|<(script|style|template)\b[\s\S]*?<\/\1\s*>|<[^>]*>/gi;

const decoder = () => document.createElement("textarea");

function decode(raw: string, into: HTMLTextAreaElement): string {
  into.innerHTML = raw;
  return into.value;
}

export function sourceSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  const box = decoder();
  let at = 0;
  const take = (end: number) => {
    const raw = source.slice(at, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body)
      segments.push({
        from: at + lead,
        to: at + lead + body.length,
        text: decode(body, box).replace(/\s+/g, " "),
      });
  };
  for (const match of source.matchAll(NOT_TEXT_RE)) {
    take(match.index);
    at = match.index + match[0].length;
  }
  take(source.length);
  return segments;
}

function drawnText(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode())
    if ((node as Text).data.trim()) nodes.push(node as Text);
  return nodes;
}

/** Whether the pointer is on the drawn words, not beside them. */
function under(node: Text, event: MouseEvent): boolean {
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some(
    (r) =>
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom,
  );
}

const norm = (text: string) => text.trim().replace(/\s+/g, " ");

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The source with each segment's words replaced; null when none changed. */
export function rewrite(
  source: string,
  segments: Segment[],
  words: string[],
): string | null {
  let out = source;
  let changed = false;
  for (let i = segments.length - 1; i >= 0; i--) {
    const next = norm(words[i]);
    if (next === segments[i].text) continue;
    changed = true;
    out =
      out.slice(0, segments[i].from) +
      escapeText(next) +
      out.slice(segments[i].to);
  }
  return changed ? out : null;
}

/** Whether the event is inside text being edited, for the widget's
 *  stopEvent: the editor leaves those events to the browser. */
export function inHtmlTextEdit(event: Event): boolean {
  return (
    event.target instanceof Node &&
    !!(
      event.target instanceof Element
        ? event.target
        : event.target.parentElement
    )?.closest(".raw-html-editing")
  );
}

/**
 * Makes the drawn block `el` editable where its text is. Answers whether a
 * mousedown should start editing instead of showing the source, or null
 * when its text can't be matched to the source.
 */
export function htmlTextEditing(
  el: HTMLElement,
  view: EditorView,
  getPos: () => number | undefined,
  source: string,
): ((event: MouseEvent) => boolean) | null {
  const segments = sourceSegments(source);
  const nodes = drawnText(el);
  if (
    nodes.length === 0 ||
    nodes.length !== segments.length ||
    nodes.some((node, i) => norm(node.data) !== segments[i].text)
  )
    return null;
  const before = nodes.map((node) => node.data);

  const stop = () => {
    el.contentEditable = "false";
    el.classList.remove("raw-html-editing");
  };
  const cancel = () => {
    nodes.forEach((node, i) => (node.data = before[i]));
    stop();
    view.focus();
  };
  const commit = () => {
    stop();
    const next = rewrite(
      source,
      segments,
      nodes.map((node) => (node.isConnected ? node.data : "")),
    );
    const to = getPos();
    if (next === null || typeof to !== "number") return;
    const html = view.state.doc.resolve(to).nodeBefore;
    // Changed under it since it was drawn: leave the source as it is.
    if (html?.type.name !== "html" || html.textContent !== source) return;
    const from = to - html.nodeSize;
    view.dispatch(
      view.state.tr.replaceWith(from + 1, to - 1, view.state.schema.text(next)),
    );
  };

  el.addEventListener("focusout", () => {
    if (el.isContentEditable) commit();
  });
  el.addEventListener("keydown", (event) => {
    if (!el.isContentEditable) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      el.blur();
      view.focus();
    }
  });
  // Words only: no new lines, formatting or pasted markup.
  el.addEventListener("beforeinput", (event) => {
    if (!el.isContentEditable) return;
    const type = event.inputType;
    if (type === "insertFromPaste" || type === "insertFromDrop") {
      event.preventDefault();
      const text = event.dataTransfer?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, text.replace(/\s+/g, " "));
    } else if (
      !/^(insertText|insertReplacementText|insertCompositionText|deleteContent|deleteWord|deleteSoftLine|deleteHardLine)/.test(
        type,
      )
    )
      event.preventDefault();
  });

  return (event) => {
    if (event.altKey || event.button !== 0) return false;
    // Only a click on the words themselves; around them shows the source.
    const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const hit = at?.startContainer;
    if (!hit || !nodes.includes(hit as Text) || !under(hit as Text, event))
      return false;
    el.contentEditable = "true";
    el.classList.add("raw-html-editing");
    return true;
  };
}
