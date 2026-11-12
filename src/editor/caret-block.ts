/**
 * What the caret sits in, read off the editor's DOM: the formatting rows
 * (the phone's keyboard strip, the desktop's format bar) light the buttons
 * that are on there.
 */
export interface CaretBlock {
  heading: number;
  bulletList: boolean;
  orderedList: boolean;
  quote: boolean;
  table: boolean;
  /** A selected image and its CSS width; null for auto. */
  image: { width: string | null } | null;
  /** The text styles on the caret's text. */
  bold: boolean;
  italic: boolean;
  strike: boolean;
  highlight: boolean;
  code: boolean;
}

export const NO_BLOCK: CaretBlock = {
  heading: 0,
  bulletList: false,
  orderedList: false,
  quote: false,
  table: false,
  image: null,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: false,
};

const EDITOR = ".milkdown .ProseMirror";

/** The caret's block in the focused editor, or in `root`'s when given (the
 *  format bar reads the document on screen without taking focus). */
export function caretBlock(root?: Element | null): CaretBlock {
  const editor =
    root?.querySelector(EDITOR) ?? document.activeElement?.closest(EDITOR);
  // ProseMirror marks the node view of a node selection; the DOM selection
  // only brackets it.
  const image = editor?.querySelector<HTMLElement>(
    ".image-view.ProseMirror-selectednode",
  );
  if (image) {
    return { ...NO_BLOCK, image: { width: image.style.width || null } };
  }
  const node = document.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || !editor?.contains(el)) return NO_BLOCK;
  const heading = el.closest("h1, h2, h3, h4, h5, h6");
  const list = el.closest("ul, ol");
  const within = (selector: string) => !!el.closest(selector);
  return {
    heading: heading ? Number(heading.tagName.slice(1)) : 0,
    bulletList: list?.tagName === "UL",
    orderedList: list?.tagName === "OL",
    quote: within("blockquote"),
    table: within("table"),
    image: null,
    bold: within("strong"),
    italic: within("em"),
    strike: within("del"),
    highlight: within("mark"),
    code: within("code:not(pre code)"),
  };
}
