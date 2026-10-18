/**
 * Whitelist renderer for the raw HTML raw-html-schema.ts stores as real
 * text: common README-style markup (alignment wrappers, images, headings,
 * bold/italic, links, <details>, tables, a few inline styles, inline SVG)
 * gets rebuilt into a small, sanitized DOM tree by the shared policy
 * (html-policy.ts, which the split view uses too); a snippet whose
 * outermost tag isn't in the whitelist - `<script>`, `<iframe>`, a stray
 * closing tag - returns null so the caller falls back to showing the raw
 * text plainly.
 */

import { ALLOWED_TAGS, INLINE_TAGS, sanitizeNodes } from "./html-policy";

type RenderedHtml = { html: string; inline: boolean } | null;

// The preview re-renders every fragment in the document on each edit, and
// a fragment's output depends on its text alone. Bounded so a long session
// of edits can't grow it without limit.
const renderCache = new Map<string, RenderedHtml>();
const RENDER_CACHE_MAX = 500;

export function renderWhitelistedHtml(raw: string): RenderedHtml {
  const cached = renderCache.get(raw);
  if (cached !== undefined) return cached;
  const rendered = renderUncached(raw);
  if (renderCache.size >= RENDER_CACHE_MAX) renderCache.clear();
  renderCache.set(raw, rendered);
  return rendered;
}

function renderUncached(raw: string): RenderedHtml {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new DOMParser().parseFromString(trimmed, "text/html");
  const body = parsed.body;
  const firstElement = Array.from(body.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE,
  ) as Element | undefined;
  if (!firstElement || !ALLOWED_TAGS.has(firstElement.localName.toLowerCase()))
    return null;

  // Built in the parsed document, which is inert: an <img> made in the
  // live page would start loading before it was ever shown.
  const wrapper = parsed.createElement("div");
  sanitizeNodes(Array.from(body.childNodes), wrapper, { linkTarget: true });
  // Inline iff nothing block-level survived at the top: the widget then
  // flows with the line it sits in (GitHub renders e.g. a lone <img> or
  // <kbd>x</kbd> inline, not as its own paragraph).
  const inline = Array.from(wrapper.children).every((el) =>
    INLINE_TAGS.has(el.tagName.toLowerCase()),
  );
  return { html: wrapper.innerHTML, inline };
}
