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
  /** Painted and waiting to go in (its paragraph is still only in the
   *  draft): the finished picture, shown instead of the shimmer. */
  preview?: string;
  /** Skipped by the user: kept small, with a way to take it after all. */
  skipped?: boolean;
  /** Accepted on its own: goes in with its text, so only 跳过 is left. */
  approved?: boolean;
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
 *  follows, so the document panel shows a picture coming instead of nothing
 *  until it is inserted. One whose passage isn't in the panel gets no card:
 *  parked at the end it read as a second, stray picture. */
export function withImagePlaceholders(
  html: string,
  pending: PendingImage[],
  label: string,
  readyLabel = label,
  /** The ready picture's own accept / reject buttons, and the line a
   *  skipped one is folded to. */
  actions?: {
    accept: string;
    reject: string;
    skipped: string;
    approved: string;
  },
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
    if (at < 0) continue;
    if (job.skipped && actions) {
      // Skipped, not gone ("万一后悔"): one quiet line under its paragraph.
      const row = document.createElement("div");
      row.className = "draft-image-skipped";
      row.dataset.job = job.id;
      const thumb = document.createElement("span");
      thumb.className = "draft-image-skipped-thumb";
      // A background, not an <img>: withImageSrc rewrites every <img>.
      // Still painting: an empty frame.
      if (job.preview)
        thumb.style.backgroundImage = `url("${job.preview.replace(/"/g, "%22")}")`;
      const note = document.createElement("span");
      note.textContent = actions.skipped;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-button";
      button.dataset.imageAction = "accept";
      button.dataset.job = job.id;
      button.textContent = actions.accept;
      row.append(thumb, note, button);
      blocks[at].after(row);
      continue;
    }
    if (job.preview) {
      // Painted: the picture itself, where and how it will sit in the
      // document, marked as part of the draft's new content.
      const figure = document.createElement("figure");
      figure.className = "draft-image-ready draft-added";
      figure.dataset.job = job.id;
      const img = document.createElement("img");
      img.src = job.preview;
      img.alt = job.prompt;
      // Already a displayable URL: withImageSrc must not read it as a
      // document path.
      img.dataset.draftPicture = "";
      const caption = document.createElement("figcaption");
      const note = document.createElement("span");
      note.textContent =
        job.approved && actions ? actions.approved : readyLabel;
      caption.append(note);
      if (job.approved) figure.classList.add("is-approved");
      if (actions)
        for (const [action, text] of job.approved
          ? [["reject", actions.reject]]
          : [
              ["accept", actions.accept],
              ["reject", actions.reject],
            ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `workspace-button${action === "accept" ? "" : " is-quiet"}`;
          button.dataset.imageAction = action;
          button.dataset.job = job.id;
          button.textContent = text;
          caption.append(button);
        }
      figure.append(img, caption);
      blocks[at].after(figure);
      continue;
    }
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
    // Decided before it is done: taken now (it goes in once painted), or
    // set aside - no waiting for the picture to say yes or no to it.
    if (actions) {
      if (job.approved) {
        card.classList.add("is-approved");
        title.textContent = `${label} · ${actions.approved}`;
      }
      const decide = document.createElement("span");
      decide.className = "draft-image-pending-actions";
      for (const [action, text] of job.approved
        ? [["reject", actions.reject]]
        : [
            ["accept", actions.accept],
            ["reject", actions.reject],
          ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `workspace-button${action === "accept" ? "" : " is-quiet"}`;
        button.dataset.imageAction = action;
        button.dataset.job = job.id;
        button.textContent = text;
        decide.append(button);
      }
      card.append(decide);
    }
    blocks[at].after(card);
  }
  return template.innerHTML;
}

/** One pending change and its paragraphs, by the text of the blocks it
 *  writes (or, for a deletion, removes) - how its place in the marked
 *  document is found. Each part names what deciding it acts on: a split
 *  paragraph its own id, an unsplit change its id and the paragraph's
 *  index in it. */
export interface ChangeTarget {
  callId: string;
  /** Its paragraphs can be decided one by one (it adds text; a rewrite or
   *  a deletion is decided whole). Default true. */
  splittable?: boolean;
  parts: { call: string; part: number; text: string }[];
  /** Its paragraphs the user rejected, shown struck through in place with
   *  恢复, after the part before them. */
  rejected?: { call: string; part: number; html: string; after: string }[];
}

const flat = (text: string) => text.replace(/[\s\u3000]+/g, " ").trim();

/** A marked block's own text: a rewrite's struck-out words left out. */
function blockText(block: Element): string {
  const copy = block.cloneNode(true) as Element;
  copy
    .querySelectorAll(".draft-del, .draft-part-actions")
    .forEach((el) => el.remove());
  return flat(copy.textContent ?? "");
}

/** Drawn, not typed: a ✓ / ✕ glyph depends on the font and read as a
 *  faint smudge in some. */
const ICONS: Record<string, string> = {
  check:
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  cross:
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
};

function actionButton(
  attrs: Record<string, string>,
  text: string,
  className: string,
  title?: string,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  for (const [key, value] of Object.entries(attrs)) button.dataset[key] = value;
  if (ICONS[text]) button.innerHTML = ICONS[text];
  else button.textContent = text;
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
  return button;
}

/** Puts the decisions where the draft is read: on each paragraph of a
 *  change that adds more than one (✓ / ✕ on hover), 采纳 / 不采纳 for the
 *  whole change after its last block (and any picture placed under it) -
 *  for the last change left, the same as 全部采纳 - and the
 *  paragraphs rejected so far, struck through with 恢复. A change whose
 *  blocks aren't found gets none - the change list still has it. */
export function withChangeActions(
  html: string,
  targets: ChangeTarget[],
  labels: {
    accept: string;
    reject: string;
    acceptPart: string;
    rejectPart: string;
    restore: string;
  },
): string {
  if (!targets.length) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks = [...template.content.children];
  // The changed blocks with words to match by. Not a picture's frame (it
  // is marked as new, but has no text of its own), and not a block with no
  // text: "" is inside every paragraph, and used to take its ✓ / ✕.
  const marked = blocks.map((block) => {
    if (
      !block.matches(".draft-added, .draft-changed, .draft-removed") ||
      block.matches(
        ".draft-image-pending, .draft-image-ready, .draft-image-skipped",
      )
    )
      return null;
    return blockText(block) || null;
  });
  const used = new Set<number>();
  const find = (raw: string) => {
    const text = flat(raw);
    if (!text) return -1;
    return marked.findIndex(
      (t, i) =>
        t !== null &&
        !used.has(i) &&
        (t === text || t.includes(text) || text.includes(t)),
    );
  };
  const pictureAfter = (el: Element) => {
    let after = el;
    while (
      after.nextElementSibling?.matches(
        ".draft-image-pending, .draft-image-ready, .draft-image-skipped",
      )
    )
      after = after.nextElementSibling;
    return after;
  };
  for (const target of targets) {
    const found: { at: number; call: string; part: number }[] = [];
    for (const part of target.parts) {
      const at = find(part.text);
      if (at < 0) continue;
      used.add(at);
      found.push({ at, call: part.call, part: part.part });
    }
    if (!found.length) continue;
    // Per paragraph, when there is more than one to choose between - and
    // only for text a change adds: a rewrite taken a paragraph at a time
    // would replace its whole passage with that one paragraph.
    if (
      target.splittable !== false &&
      target.parts.length + (target.rejected?.length ?? 0) > 1
    )
      for (const { at, call, part } of found) {
        const bar = document.createElement("span");
        bar.className = "draft-part-actions";
        bar.append(
          actionButton(
            { partAction: "accept", call, part: String(part) },
            "check",
            "draft-part-button",
            labels.acceptPart,
          ),
          actionButton(
            { partAction: "reject", call, part: String(part) },
            "cross",
            "draft-part-button",
            labels.rejectPart,
          ),
        );
        blocks[at].classList.add("draft-part");
        blocks[at].append(bar);
      }
    // Rejected paragraphs, back where they were.
    for (const gone of target.rejected ?? []) {
      const anchor = blocks.findIndex(
        (block, i) => used.has(i) && blockText(block) === flat(gone.after),
      );
      const ghost = document.createElement("div");
      ghost.className = "draft-part-rejected";
      ghost.innerHTML = gone.html;
      ghost.append(
        actionButton(
          { restore: gone.call },
          labels.restore,
          "workspace-button draft-part-restore",
        ),
      );
      if (anchor >= 0) pictureAfter(blocks[anchor]).after(ghost);
      else blocks[found[0].at].before(ghost);
    }
    const last = Math.max(...found.map((f) => f.at));
    let after = pictureAfter(blocks[last]);
    while (after.nextElementSibling?.matches(".draft-part-rejected"))
      after = after.nextElementSibling;
    const bar = document.createElement("div");
    bar.className = "draft-change-actions";
    bar.dataset.call = target.callId;
    bar.append(
      actionButton(
        { changeAction: "accept", call: target.callId },
        labels.accept,
        "workspace-button",
      ),
      actionButton(
        { changeAction: "reject", call: target.callId },
        labels.reject,
        "workspace-button is-quiet",
      ),
    );
    after.after(bar);
  }
  return template.innerHTML;
}
