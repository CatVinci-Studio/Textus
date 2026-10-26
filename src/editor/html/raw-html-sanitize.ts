/**
 * Renders raw HTML through the shared allow-list. A snippet whose outermost
 * tag isn't allowed returns null, so the caller shows the raw text.
 */

import { ALLOWED_TAGS, INLINE_TAGS, sanitizeNodes } from "./html-policy";

type RenderedHtml = { html: string; inline: boolean } | null;

// The preview re-renders every fragment on each edit, and the output
// depends on the text alone. Bounded.
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

  // Built in the inert parsed document: an <img> made in the live page would
  // start loading before it was shown.
  const wrapper = parsed.createElement("div");
  sanitizeNodes(Array.from(body.childNodes), wrapper, { linkTarget: true });
  // Inline iff nothing block-level survived at the top, as GitHub renders a
  // lone <img> or <kbd>.
  const inline = Array.from(wrapper.children).every((el) =>
    INLINE_TAGS.has(el.tagName.toLowerCase()),
  );
  return { html: wrapper.innerHTML, inline };
}
