import { onAppearance } from "../../engine/tokens/appearance";
/**
 * The theme a plugin's webview is drawn in: the plugin API's variables with
 * their current values, a fixed list so a theme reworking the window's own
 * variables doesn't change what a plugin sees.
 */
export const WEBVIEW_THEME_VARS = [
  // The interface's size step, which the page's lengths grow with.
  "--ui-text-scale",
  "--window-scale",
  "--icon-scale",
  "--ui-bg",
  "--ui-surface",
  "--ui-subtle",
  "--ui-text",
  "--ui-muted",
  "--ui-accent",
  "--ui-accent-text",
  "--ui-accent-fill",
  "--ui-primary",
  "--ui-on-primary",
  "--ui-on-fill",
  "--ui-border",
  "--ui-hover",
  "--ui-selected",
  "--ui-selected-text",
  "--ui-danger",
  "--ui-success",
  "--ui-warning",
  // The frame round the pages: its tint, and its paint when one is set.
  "--ui-frame-tint",
  "--ui-frame-paint",
  "--doc-bg",
  "--doc-text",
  "--doc-accent",
  "--doc-accent-text",
  // The palette's mark: highlights, "look here".
  "--doc-mark",
  "--doc-code-bg",
  "--doc-border",
  "--doc-radius",
  "--doc-muted",
  // The five alert colours: a plugin's tags take them, so a theme
  // recolours those too.
  "--doc-alert-note",
  "--doc-alert-tip",
  "--doc-alert-important",
  "--doc-alert-warning",
  "--doc-alert-caution",
  "--doc-highlight-bg",
  "--font-sans",
  "--font-mono",
  "--doc-font",
  "--text-caption",
  "--text-footnote",
  "--text-secondary",
  "--text-control",
  "--text-body",
  "--text-body-large",
  "--text-title",
  "--shape-l",
  "--shape-m",
  "--shape-s",
  "--shape-xs",
  "--shape-pill",
  "--shadow-popover",
  // Tones: the categorical colours, the theme's palette when it has one.
  "--tone-blue",
  "--tone-blue-text",
  "--tone-blue-tint",
  "--tone-green",
  "--tone-green-text",
  "--tone-green-tint",
  "--tone-orange",
  "--tone-orange-text",
  "--tone-orange-tint",
  "--tone-purple",
  "--tone-purple-text",
  "--tone-purple-tint",
  "--tone-red",
  "--tone-red-text",
  "--tone-red-tint",
  "--tone-teal",
  "--tone-teal-text",
  "--tone-teal-tint",
  "--tone-yellow",
  "--tone-yellow-text",
  "--tone-yellow-tint",
  "--tone-pink",
  "--tone-pink-text",
  "--tone-pink-tint",
  "--tone-gray",
  "--tone-gray-text",
  "--tone-gray-tint",
  "--control-height",
  "--control-height-sm",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  // Interface Size's presets (ui-sizes.css) a page's panes are built on.
  "--pane-inset",
  "--pane-edge",
  "--tree-step",
  "--icon-button-s",
  "--text-list",
  // Motion as the window has it now: under reduced motion the distances are
  // 0, so a plugin's moves turn into fades.
  "--dur-fast",
  "--dur-base",
  "--dur-medium",
  "--dur-slow",
  "--dur-stagger",
  "--ease-out",
  "--ease-in",
  "--ease-in-out",
  "--motion-distance-sm",
  "--motion-distance-md",
  "--motion-mark-bg",
] as const;

/** Whether the window shows its dark appearance now. */
export function windowIsDark(): boolean {
  return getComputedStyle(document.documentElement).colorScheme === "dark";
}

/** A `:root {…}` rule giving each variable its value in the window now. A
 *  page drawn in the document grows with the document's zoom, not with
 *  the window. */
/** The interface's text at body size (--text-body's 13px at scale 1). */
const UI_BODY_PX = 13;

/** A page in the document reads as the document does: its text at the
 *  body's size, its controls in step, the window's own growth left out. */
function inDocumentScale(editor: Element | null): string[] {
  const text = editor?.querySelector(".ProseMirror") ?? editor;
  const px = text ? parseFloat(getComputedStyle(text).fontSize) : NaN;
  const scale = Number.isFinite(px) && px > 0 ? px / UI_BODY_PX : 1;
  return ["  --window-scale: 1;", `  --ui-text-scale: ${scale.toFixed(3)};`];
}

export function webviewThemeCss(inDocument = false): string {
  const style = getComputedStyle(document.documentElement);
  // The alert colours are the document's, set on the editor.
  const editor = document.querySelector(".milkdown");
  const doc = editor ? getComputedStyle(editor) : style;
  const body = WEBVIEW_THEME_VARS.map((name) => {
    const from = name.startsWith("--doc-alert-") ? doc : style;
    const value = from.getPropertyValue(name).trim();
    return value ? `  ${name}: ${value};` : "";
  })
    .filter(Boolean)
    .concat(inDocument ? inDocumentScale(editor) : [])
    .join("\n");
  return `:root {\n${body}\n}`;
}

/**
 * Calls `onChange` whenever the window's theme may have changed. Returns the
 * function that stops listening.
 */
export function watchTheme(onChange: () => void): () => void {
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      onChange();
    });
  };
  return onAppearance(changed);
}
