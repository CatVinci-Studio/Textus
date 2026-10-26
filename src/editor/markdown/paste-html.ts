/**
 * Pasted HTML as the page it was copied from meant it (1.2.2):
 *
 * - Google Docs and Word for the web write bold, italic and struck text
 *   as styles on a span (`font-weight:700`), which a Markdown document has
 *   no use for - so they came in plain. They become <strong>, <em> and
 *   <del>. Word for the web's headings are `<p role="heading">`.
 * - Mail writes its blank lines as paragraphs of their own - Outlook's
 *   `<p><o:p>&nbsp;</o:p></p>`, Apple Mail's and Docs' `<br>` between
 *   blocks - which came in as empty paragraphs, a page of them in a long
 *   thread. They go: the paragraphs are apart already.
 * - Outlook's Safe Links wrap every link in a redirect; the link is the
 *   address it redirects to.
 *
 * What Textus copies itself (ProseMirror's `data-pm-slice`) is left as it
 * is.
 */

const BLOCKS = "p,div,li,blockquote,h1,h2,h3,h4,h5,h6,section,article";

/** The marks `style` gives its text. */
function styleMarks(style: CSSStyleDeclaration): string[] {
  const marks: string[] = [];
  const weight = style.fontWeight;
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600)
    marks.push("strong");
  if (style.fontStyle === "italic") marks.push("em");
  if (/line-through/.test(style.textDecoration || style.textDecorationLine))
    marks.push("del");
  return marks;
}

/** `el`'s content wrapped in each of `marks`. */
function wrapContent(el: Element, marks: string[]) {
  const doc = el.ownerDocument;
  let inner: Element | null = null;
  let outer: Element | null = null;
  for (const mark of marks) {
    const node = doc.createElement(mark);
    if (inner) inner.appendChild(node);
    else outer = node;
    inner = node;
  }
  if (!outer || !inner) return;
  while (el.firstChild) inner.appendChild(el.firstChild);
  el.appendChild(outer);
}

/** Whether `el` holds nothing to read: spaces, a lone break. */
function empty(el: Element): boolean {
  return (
    (el.textContent ?? "").trim() === "" &&
    !el.querySelector("img,table,hr,input,svg,video,iframe")
  );
}

/** `html` with what its source meant by its styles and spacing. */
export function cleanPastedHtml(html: string): string {
  if (!html || html.includes("data-pm-slice")) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  let changed = false;

  for (const p of root.querySelectorAll<HTMLElement>(
    '[role="heading"][aria-level]',
  )) {
    const level = Math.min(
      6,
      Math.max(1, Number(p.getAttribute("aria-level"))),
    );
    if (!level || /^H\d$/.test(p.tagName)) continue;
    const h = p.ownerDocument.createElement(`h${level}`);
    while (p.firstChild) h.appendChild(p.firstChild);
    p.replaceWith(h);
    changed = true;
  }

  for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
    if (el.closest("pre,code,h1,h2,h3,h4,h5,h6")) continue;
    // Docs' `<b style="font-weight:normal">` round everything: not bold.
    if (/^(B|STRONG|EM|I|DEL|S)$/.test(el.tagName)) continue;
    const marks = styleMarks(el.style).filter((m) => !el.closest(m));
    if (!marks.length || (el.textContent ?? "").trim() === "") continue;
    wrapContent(el, marks);
    changed = true;
  }

  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!/safelinks\.protection\.outlook\.com/i.test(href)) continue;
    const real =
      a.getAttribute("originalsrc") ??
      new URL(href, "https://x.invalid").searchParams.get("url");
    if (real) {
      a.setAttribute("href", real);
      a.removeAttribute("title");
      changed = true;
    }
  }

  // Innermost first, so a block left empty by its empty children goes too.
  for (const el of [...root.querySelectorAll(BLOCKS)].reverse()) {
    if (el.closest("pre,td,th") || !empty(el)) continue;
    el.remove();
    changed = true;
  }
  for (const br of root.querySelectorAll("br")) {
    const parent = br.parentNode;
    const blocksAround = [br.previousElementSibling, br.nextElementSibling]
      .filter(Boolean)
      .some((s) => s!.matches(BLOCKS + ",ul,ol,table"));
    if ((parent === root || blocksAround) && !br.closest("pre,td,th,p,li")) {
      br.remove();
      changed = true;
    }
  }

  if (!changed) return html;
  const out = document.createElement("div");
  out.appendChild(root.cloneNode(true));
  return out.innerHTML;
}
