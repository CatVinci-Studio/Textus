import {
  renderDocumentHtml,
  renderMarkdownInlineHtml,
} from "../../editor/markdown/render-html";
import { onKatexReady } from "../../editor/math/katex-loader";
import {
  pendingDiagram,
  splitMermaidFences,
} from "../../editor/pending-diagram";
import { showGeneratedImages, shownGeneratedSrc } from "./generated-images";
import { framePendingPictures } from "./pending-picture";

/** A proposal's text put into the document as it arrives: HTML, blocks,
 *  pictures, and math once KaTeX has loaded. */

/** New text into its widget, as rendered Markdown, each line its own tinted
 *  span: one box over several lines paints padding at every line end. */
export function renderPendingHtml(span: HTMLElement, markdown: string) {
  fillPendingHtml(span, markdown);
  if (span.querySelector(".math-pending")) awaitKatex(span, markdown);
  else waitingForKatex.delete(span);
}

// Widgets showing a formula's source while KaTeX loads, redrawn once it is
// here, since a widget kept by its key wouldn't be.
const waitingForKatex = new Map<HTMLElement, string>();

function awaitKatex(span: HTMLElement, markdown: string) {
  if (waitingForKatex.size === 0)
    onKatexReady(() => {
      for (const [waiting, text] of waitingForKatex)
        if (waiting.isConnected) fillPendingHtml(waiting, text);
      waitingForKatex.clear();
    });
  waitingForKatex.set(span, markdown);
}

function fillPendingHtml(span: HTMLElement, source: string) {
  fillPendingContent(span, source);
  // A picture still being made is its frame until it comes.
  framePendingPictures(span);
}

/** A waiting picture's placeholder, as an address the document renderer's
 *  HTML policy keeps (it drops blob: and textus-generated:). */
const PICTURE_STAND_IN = "https://textus.invalid/generated/";

/** New text between two blocks, rendered as the blocks it will be, as
 *  inline text would show its Markdown. */
function fillPendingBlocks(el: HTMLElement, source: string) {
  const parts = splitMermaidFences(source) ?? [
    { kind: "text" as const, text: source },
  ];
  const previous = el.querySelectorAll<HTMLElement>(".pending-diagram");
  let diagrams = 0;
  const nodes = parts.flatMap((part) => {
    if (part.kind === "diagram")
      return [pendingDiagram(part, previous[diagrams++])];
    const html = document.createElement("template");
    html.innerHTML = renderDocumentHtml(
      part.text.replace(/textus-generated:/g, PICTURE_STAND_IN),
    );
    for (const img of html.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith(PICTURE_STAND_IN))
        img.setAttribute(
          "src",
          shownGeneratedSrc(src.slice(PICTURE_STAND_IN.length)),
        );
    }
    return [...html.content.childNodes];
  });
  el.replaceChildren(...nodes);
}

/** Text that is blocks of its own: more than one paragraph, or a
 *  heading, a list, a quote, a table, a fence or a formula. */
export function hasBlocks(text: string): boolean {
  return (
    /\n[ \t]*\n/.test(text.trim()) ||
    /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\$\$)/m.test(text)
  );
}

function fillPendingContent(span: HTMLElement, source: string) {
  // A widget is made once, often before any of its text has come: text at
  // the caret that turns out to be blocks becomes blocks when it does.
  if (
    span.dataset.blocks !== "true" &&
    span.classList.contains("pending-whole") &&
    hasBlocks(source)
  ) {
    span.dataset.blocks = "true";
    span.classList.add("pending-blocks");
    span.classList.remove("pending-insert-lines");
  }
  if (span.dataset.blocks === "true") {
    fillPendingBlocks(span, source);
    return;
  }
  // A proposed picture (generate_image) is drawn from its bytes, which
  // only the preview holds.
  const markdown = showGeneratedImages(source);
  const parts = splitMermaidFences(markdown);
  let nodes: Node[];
  if (!parts) {
    span.innerHTML = renderMarkdownInlineHtml(markdown);
    nodes = [...span.childNodes];
  } else {
    // A ```mermaid fence is drawn as its diagram, keeping its element across
    // the typewriter's frames.
    const previous = span.querySelectorAll<HTMLElement>(".pending-diagram");
    let diagrams = 0;
    nodes = parts.flatMap((part) => {
      if (part.kind === "diagram")
        return [pendingDiagram(part, previous[diagrams++])];
      const html = document.createElement("template");
      html.innerHTML = renderMarkdownInlineHtml(part.text);
      return [...html.content.childNodes];
    });
  }
  const lines = !!parts || nodes.some((n) => n.nodeName === "BR");
  span.classList.toggle("pending-insert-lines", lines);
  if (!lines) return;
  span.textContent = "";
  let line: HTMLElement | null = null;
  for (const node of nodes) {
    const blank = node.nodeType === Node.TEXT_NODE && !node.textContent?.trim();
    const diagram =
      node instanceof HTMLElement && node.classList.contains("pending-diagram");
    if (node.nodeName === "BR" || diagram || (blank && !line)) {
      span.append(node);
      line = null;
      continue;
    }
    if (!line) {
      line = document.createElement("span");
      line.className = "pending-line";
      span.append(line);
    }
    line.append(node);
  }
}
