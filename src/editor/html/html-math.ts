// Formulas in raw HTML: GitHub and Typora draw `$x$` and `\(x\)` inside an
// HTML block or table too. Never in code, and only where KaTeX has loaded.
import { katexNow } from "../math/katex-loader";
import { renderFormula } from "../math/matrix-rows";
import { looksLikeLatex } from "../../utils/markdown-math";

// Display first, so `$$x$$` isn't read as two inline formulas. Inline `$`
// follows the editor's rule: no space just inside, no digit after.
const MATH =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

const VERBATIM = new Set(["code", "pre", "kbd", "samp", "script", "style"]);

/** Whether `text` may hold a formula, cheaply. */
export const mayHaveHtmlMath = (text: string) => /\$|\\[([]/.test(text);

/** `root`'s formulas drawn in place; false when KaTeX isn't loaded yet. */
export function drawHtmlMath(root: Element): boolean {
  const katex = katexNow();
  if (!katex) return false;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (
        let el = node.parentElement;
        el && el !== root;
        el = el.parentElement
      )
        if (VERBATIM.has(el.localName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    const value = text.data;
    if (!mayHaveHtmlMath(value)) continue;
    const parts: (string | Element)[] = [];
    let last = 0;
    for (const m of value.matchAll(MATH)) {
      const [whole, display, bracket, paren, inline] = m;
      if (bracket !== undefined && !looksLikeLatex(bracket)) continue;
      const source = display ?? bracket ?? paren ?? inline;
      const displayMode = display !== undefined || bracket !== undefined;
      const el = doc.createElement("span");
      el.className = "html-math";
      try {
        el.innerHTML = renderFormula(katex, source.trim(), {
          displayMode,
          throwOnError: false,
        });
      } catch {
        continue;
      }
      parts.push(value.slice(last, m.index), el);
      last = m.index + whole.length;
    }
    if (last === 0) continue;
    parts.push(value.slice(last));
    text.replaceWith(...parts);
  }
  return true;
}
