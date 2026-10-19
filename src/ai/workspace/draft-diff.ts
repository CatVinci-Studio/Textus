/**
 * What a draft changes, marked in the rendered document (the Agent's draft
 * preview): blocks it adds, blocks it rewrites - their new words in <ins>,
 * the words they lose in <del> - and blocks it removes, kept and struck
 * through. The preview used to show the finished text only, with nothing to
 * say where the new paragraph went or what a rewrite changed.
 *
 * Block-level: the rendered top-level elements are aligned by their HTML
 * (longest common subsequence), and only a rewritten block gets a word-level
 * look - one changed span between its common start and end, which is what
 * an insert or a replace inside a paragraph produces.
 */

/** Past this many block pairs the alignment falls back to matching the
 *  unchanged start and end only (a draft of a very long document). */
const LCS_LIMIT = 250_000;

function blocksOf(html: string): Element[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return [...template.content.children];
}

type Step =
  | { kind: "same"; next: Element }
  | { kind: "removed"; base: Element }
  | { kind: "added"; next: Element };

function align(base: Element[], next: Element[]): Step[] {
  const a = base.map((el) => el.outerHTML);
  const b = next.map((el) => el.outerHTML);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const steps: Step[] = [];
  for (let i = 0; i < start; i++) steps.push({ kind: "same", next: next[i] });
  const n = endA - start;
  const m = endB - start;
  if (n * m <= LCS_LIMIT) {
    // lcs[i][j]: longest common run of a[start+i..] and b[start+j..].
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i][j] =
          a[start + i] === b[start + j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        steps.push({ kind: "same", next: next[start + j] });
        i++;
        j++;
      } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        steps.push({ kind: "added", next: next[start + j] });
        j++;
      } else {
        steps.push({ kind: "removed", base: base[start + i] });
        i++;
      }
    }
  } else {
    for (let i = start; i < endA; i++)
      steps.push({ kind: "removed", base: base[i] });
    for (let j = start; j < endB; j++)
      steps.push({ kind: "added", next: next[j] });
  }
  for (let j = endB; j < next.length; j++)
    steps.push({ kind: "same", next: next[j] });
  return steps;
}

/** Wraps the text between `from` and `to` (character offsets into the
 *  element's text) in `wrapper`, across however many text nodes it spans. */
function wrapRange(el: Element, from: number, to: number, tag: "ins") {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text);
  let offset = 0;
  for (const node of nodes) {
    const length = node.data.length;
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, length);
    offset += length;
    if (end <= start) continue;
    let target = node;
    if (start > 0) target = target.splitText(start);
    if (end - start < target.data.length) target.splitText(end - start);
    const mark = document.createElement(tag);
    mark.className = "draft-ins";
    target.replaceWith(mark);
    mark.append(target);
  }
}

/** Puts `<del>removed</del>` at character offset `at` of the element. */
function insertRemoved(el: Element, at: number, removed: string) {
  const del = document.createElement("del");
  del.className = "draft-del";
  del.textContent = removed;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (at <= offset + text.data.length) {
      const after = text.splitText(at - offset);
      after.before(del);
      return;
    }
    offset += text.data.length;
  }
  el.append(del);
}

/** A rewritten block: its one changed span marked, when there is one
 *  small enough to point at; otherwise the whole block is the change. */
function markRewrite(next: Element, base: Element) {
  next.classList.add("draft-changed");
  const before = base.textContent ?? "";
  const after = next.textContent ?? "";
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const added = after.slice(start, after.length - end);
  const removed = before.slice(start, before.length - end);
  // Most of the block rewritten: marking every word says nothing more.
  if (added.length + removed.length > 0.8 * Math.max(after.length, 1)) return;
  if (added) wrapRange(next, start, after.length - end, "ins");
  if (removed) insertRemoved(next, start, removed);
}

export interface DraftChanges {
  html: string;
  /** Changed places - runs of added, rewritten or removed blocks. */
  changes: number;
}

/** `next` (the document with the draft applied) with what differs from
 *  `base` (the document now) marked. */
export function markDraftChanges(
  baseHtml: string,
  nextHtml: string,
): DraftChanges {
  const steps = align(blocksOf(baseHtml), blocksOf(nextHtml));
  const out: Element[] = [];
  let changes = 0;
  let run: { removed: Element[]; added: Element[] } | null = null;
  const flush = () => {
    if (!run) return;
    changes++;
    const { removed, added } = run;
    const pairs = Math.min(removed.length, added.length);
    // Removed blocks with no added one in their place stay, struck through.
    for (const base of removed.slice(pairs)) {
      const ghost = base.cloneNode(true) as Element;
      ghost.classList.add("draft-removed");
      ghost.setAttribute("aria-hidden", "true");
      out.push(ghost);
    }
    added.forEach((next, i) => {
      if (i < pairs) markRewrite(next, removed[i]);
      else next.classList.add("draft-added");
      out.push(next);
    });
    run = null;
  };
  for (const step of steps) {
    if (step.kind === "same") {
      flush();
      out.push(step.next);
      continue;
    }
    run ??= { removed: [], added: [] };
    if (step.kind === "removed") run.removed.push(step.base);
    else run.added.push(step.next);
  }
  flush();
  return { html: out.map((el) => el.outerHTML).join(""), changes };
}

/** A picture still being made, for the document panel. */
export interface PendingImage {
  id: string;
  /** The passage it follows, as markdown (a heading, a sentence). */
  anchor: string;
  prompt: string;
}

/** The text an anchor reads as in the rendered document. */
function anchorText(anchor: string): string {
  return (anchor.split("\n").find((line) => line.trim()) ?? "")
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/[*_`~]/g, "")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

/** Puts a "making this picture" card after the block each pending picture
 *  follows (at the end when its passage isn't found), so the document panel
 *  shows a picture coming instead of nothing until it is inserted. */
export function withImagePlaceholders(
  html: string,
  pending: PendingImage[],
  label: string,
): string {
  if (!pending.length) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks = [...template.content.children];
  const texts = blocks.map((block) =>
    (block.textContent ?? "").replace(/[\s\u3000]+/g, " "),
  );
  for (const job of pending) {
    const text = anchorText(job.anchor);
    const at = text ? texts.findIndex((t) => t.includes(text)) : -1;
    const card = document.createElement("div");
    card.className = "draft-image-pending";
    card.dataset.job = job.id;
    const thumb = document.createElement("span");
    thumb.className = "draft-image-pending-thumb";
    const body = document.createElement("span");
    body.className = "draft-image-pending-text";
    const title = document.createElement("strong");
    title.textContent = label;
    const prompt = document.createElement("span");
    prompt.textContent = job.prompt;
    body.append(title, prompt);
    card.append(thumb, body);
    if (at >= 0) blocks[at].after(card);
    else template.content.append(card);
  }
  return template.innerHTML;
}
