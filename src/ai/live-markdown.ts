import {
  markdownBlocks,
  renderMarkdownHtml,
} from "../editor/markdown/render-html";

/** What a streaming reply shows: each block's source and the nodes drawn
 *  for it, straight under the reply's element. */
interface ShownBlocks {
  sources: string[];
  nodes: ChildNode[][];
}

export const noBlocks = (): ShownBlocks => ({ sources: [], nodes: [] });

/**
 * Draws `text` into `root` block by block: the blocks it showed already are
 * kept as they are (their nodes, their place, their fade), and only those
 * that changed - the last, as a reply streams - are drawn again. A long
 * reply's update costs its last block, not the whole of it.
 */
export function showBlocks(
  root: HTMLElement,
  text: string,
  shown: ShownBlocks,
): void {
  const sources = markdownBlocks(text);
  let same = 0;
  while (
    same < sources.length &&
    same < shown.sources.length &&
    sources[same] === shown.sources[same]
  )
    same++;
  for (const nodes of shown.nodes.splice(same))
    for (const node of nodes) node.remove();
  shown.sources.length = same;
  for (const source of sources.slice(same)) {
    const template = document.createElement("template");
    // Safe: renderMarkdownHtml sanitizes.
    template.innerHTML = renderMarkdownHtml(source);
    const nodes = Array.from(template.content.childNodes);
    root.append(...nodes);
    shown.nodes.push(nodes);
    shown.sources.push(source);
  }
}
