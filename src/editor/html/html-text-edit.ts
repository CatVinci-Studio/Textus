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
  // The widget stays out of the editor's editing; a box inside it is its
  // own editing host, with its own focus and keys.
  const box = document.createElement("div");
  box.className = "raw-html-edit-box";
  box.append(...el.childNodes);
  el.append(box);
  const before = nodes.map((node) => node.data);
  // Typing at an edge can start a new text node beside the old one, so an
  // element holding one run of words is read by all its own text nodes -
  // not its children's, as a <ruby>'s <rt> reading is.
  const parents = nodes.map((node) => node.parentElement!);
  const children = parents.map((parent) => [...parent.childNodes]);
  const alone = (i: number) =>
    parents.filter((parent) => parent === parents[i]).length === 1;
  const ownText = (parent: Element) =>
    [...parent.childNodes]
      .filter((child): child is Text => child instanceof Text)
      .map((child) => child.data)
      .join("");
  const wordsNow = (node: Text, i: number) =>
    alone(i) ? ownText(parents[i]) : node.isConnected ? node.data : "";

  // The editor keeps the focus around text edited inside it, so leaving
  // is seen as the selection moving out.
  const left = () => {
    const at = getSelection()?.anchorNode;
    if (!at || !box.contains(at)) commit();
  };
  const stop = () => {
    box.contentEditable = "false";
    box.classList.remove("raw-html-editing");
    document.removeEventListener("selectionchange", left);
  };
  const cancel = () => {
    nodes.forEach((node, i) => {
      if (alone(i)) parents[i].replaceChildren(...children[i]);
      node.data = before[i];
    });
    stop();
    view.focus();
  };
  const commit = () => {
    stop();
    const next = rewrite(source, segments, nodes.map(wordsNow));
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

  box.addEventListener("keydown", (event) => {
    if (!box.isContentEditable) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      commit();
      view.focus();
    }
  });
  // Words only: no new lines, formatting or pasted markup.
  box.addEventListener("beforeinput", (event) => {
    if (!box.isContentEditable) return;
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
    // A click in a cell, line or heading with words; on a picture, a
    // border or the block's own margin it shows the source.
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target === el ||
      target === box ||
      !nodes.some((node) => target.contains(node))
    )
      return false;
    // Its own focus, so its keys come to it and not to the editor; the
    // caret where the click was.
    event.preventDefault();
    const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    box.contentEditable = "true";
    box.classList.add("raw-html-editing");
    box.focus({ preventScroll: true });
    const selection = getSelection();
    if (selection) {
      if (at && box.contains(at.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(at);
      } else {
        selection.selectAllChildren(target);
        selection.collapseToEnd();
      }
    }
    document.addEventListener("selectionchange", left);
    return true;
  };
}
