/**
 * The theme a plugin's webview is drawn in: the plugin API's variables with
 * their current values, a fixed list so a theme reworking the window's own
 * variables doesn't change what a plugin sees.
 */
export const WEBVIEW_THEME_VARS = [
  "--ui-bg",
  "--ui-surface",
  "--ui-subtle",
  "--ui-text",
  "--ui-muted",
  "--ui-accent",
  "--ui-border",
  "--ui-hover",
  "--ui-selected",
  "--ui-selected-text",
  "--ui-danger",
  "--ui-success",
  "--ui-warning",
  "--doc-bg",
  "--doc-text",
  "--doc-accent",
  "--doc-code-bg",
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
  "--control-height",
  "--control-height-sm",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
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

/** A `:root {…}` rule giving each variable its value in the window now. */
export function webviewThemeCss(): string {
  const style = getComputedStyle(document.documentElement);
  const body = WEBVIEW_THEME_VARS.map((name) => {
    const value = style.getPropertyValue(name).trim();
    return value ? `  ${name}: ${value};` : "";
  })
    .filter(Boolean)
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
  const html = new MutationObserver(changed);
  html.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class", "lang"],
  });
  const head = new MutationObserver(changed);
  head.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
  dark?.addEventListener("change", changed);
  return () => {
    html.disconnect();
    head.disconnect();
    dark?.removeEventListener("change", changed);
  };
}
