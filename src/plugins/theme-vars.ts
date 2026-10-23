/**
 * The theme a plugin's webview is drawn in: these variables, with the
 * values they have in the window now. They are the plugin API's colours
 * and sizes (docs/dev/plugin-api.md) - kept to this list so a theme
 * reworking the window's own variables doesn't change what a plugin sees.
 */
export const WEBVIEW_THEME_VARS = [
  "--bg",
  "--chrome-text",
  "--chrome-muted",
  "--chrome-accent",
  "--editor-text",
  "--editor-muted",
  "--editor-accent",
  "--editor-border",
  "--editor-code-bg",
  "--editor-highlight-bg",
  "--danger",
  "--sidebar-bg",
  "--sidebar-text",
  "--sidebar-hover",
  "--sidebar-active",
  "--sidebar-active-text",
  "--border-color",
  "--font-sans",
  "--font-mono",
  "--editor-font",
  "--text-xs",
  "--text-sm",
  "--text-md",
  "--text-lg",
  "--text-xl",
  "--radius-small",
  "--radius-control",
  "--radius-block",
  "--control-height",
  "--control-height-sm",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  // Motion (docs/design/design-language.md, Motion), as the window has it
  // now: under reduced motion the distances are 0, so a plugin's moves
  // turn into fades with the app's.
  "--dur-fast",
  "--dur-base",
  "--dur-medium",
  "--dur-slow",
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
 * Calls `onChange` whenever the window's theme may have changed - the
 * appearance attributes on <html>, a theme's stylesheet coming or going,
 * the system turning dark. Returns the function that stops listening.
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
