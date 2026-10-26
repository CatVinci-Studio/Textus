/** Derive application colors from an imported document theme. */
type RGB = readonly [number, number, number];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [24, 28, 36];
const rgb = (c: RGB) => `rgb(${c.map(Math.round).join(", ")})`;
const mix = (a: RGB, b: RGB, amount: number): RGB => {
  const at = (i: 0 | 1 | 2) => a[i] * (1 - amount) + b[i] * amount;
  return [at(0), at(1), at(2)];
};
const luminance = (c: RGB) =>
  c.reduce((sum, v, i) => {
    const s = v / 255;
    return (
      sum +
      (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][i]
    );
  }, 0);
export const contrast = (a: RGB, b: RGB) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
function readable(color: RGB, background: RGB, ratio = 4.5): RGB {
  const target =
    contrast(WHITE, background) > contrast(INK, background) ? WHITE : INK;
  for (let i = 0; i <= 100; i++) {
    const candidate = mix(color, target, i / 100);
    if (contrast(candidate, background) >= ratio) return candidate;
  }
  return target;
}
export function chromePalette(background: RGB, foreground: RGB, accent: RGB) {
  const text = readable(foreground, background);
  const dark = luminance(background) < 0.3;
  const subtle = mix(background, text, 0.035);
  const active = mix(background, readable(accent, background), 0.14);
  return {
    "--bg": rgb(background),
    "--chrome-text": rgb(text),
    "--chrome-muted": rgb(readable(mix(background, text, 0.6), subtle)),
    "--chrome-accent": rgb(readable(accent, background)),
    "--chrome-primary": rgb(readable(accent, WHITE)),
    "--chrome-subtle": rgb(subtle),
    "--sidebar-bg": rgb(subtle),
    "--sidebar-text": rgb(text),
    "--sidebar-hover": rgb(mix(background, text, 0.08)),
    "--sidebar-active": rgb(
      mix(background, readable(accent, background), 0.14),
    ),
    "--sidebar-active-text": rgb(readable(text, active)),
    "--border-color": rgb(mix(background, text, 0.18)),
    "--danger": rgb(readable([190, 54, 75], background)),
    // A fill that carries --on-fill's white whatever the page.
    "--danger-fill": rgb(readable([190, 54, 75], WHITE)),
    "--success-color": rgb(readable([36, 115, 77], background)),
    "--warning-color": rgb(readable([154, 98, 18], background)),
    "--overlay-bg": dark ? "rgb(0 0 0 / 48%)" : "rgb(20 27 40 / 30%)",
    "--shadow-popover": dark
      ? "0 4px 16px rgb(0 0 0 / 24%)"
      : "0 4px 16px rgb(20 27 40 / 10%)",
    "--shadow-dialog": dark
      ? "0 16px 48px rgb(0 0 0 / 32%)"
      : "0 16px 48px rgb(20 27 40 / 16%)",
    "--shadow-sheet": dark
      ? "0 -8px 24px rgb(0 0 0 / 40%)"
      : "0 -8px 24px rgb(0 0 0 / 14%)",
    "--shadow-drawer": dark
      ? "8px 0 24px rgb(0 0 0 / 40%)"
      : "8px 0 24px rgb(0 0 0 / 16%)",
    "color-scheme": dark ? "dark" : "light",
  };
}

/** The text column a theme's `#write { max-width }` asks for, or null. A
 *  length gets the column's side padding added; a percentage spans the pane
 *  and #write narrows itself. */
export function themeColumnWidth(maxWidth: string): string | null {
  const value = maxWidth.trim();
  if (!value || value === "none") return null;
  if (value.endsWith("%")) return "100%";
  if (/^\d+(\.\d+)?px$/.test(value)) return `calc(${value} + 3rem)`;
  return null;
}

/** Also the id of the boot script's first-frame copy, so applying here
 *  replaces that one. */
const STYLE_ID = "textus-imported-chrome";
export function clearThemeChrome() {
  document.getElementById(STYLE_ID)?.remove();
}

/** Derived in an isolated document, so a reapply doesn't sample our own
 *  palette. Returns the stylesheet applied, or null when it couldn't derive one. */
export function applyThemeChrome(css: string, dark: boolean): string | null {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.width = String(window.innerWidth);
  frame.height = String(window.innerHeight);
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) return null;
    doc.documentElement.dataset.theme = dark ? "dark" : "light";
    const base = doc.createElement("style");
    base.textContent = `body { background: var(--bg-color, var(--editor-bg, var(--bg, ${dark ? "#1b1e24" : "#fff"}))); color: var(--text-color, var(--editor-text, ${dark ? "#e4e7ed" : "#24272e"})); } a { color: var(--primary-color, var(--editor-accent, #315ed1)); }`;
    const theme = doc.createElement("style");
    theme.textContent = css;
    doc.head.append(base, theme);
    const write = doc.createElement("div");
    write.id = "write";
    write.className = "ProseMirror";
    const link = doc.createElement("a");
    link.href = "#";
    link.textContent = "Textus";
    write.appendChild(link);
    const milkdown = doc.createElement("div");
    milkdown.className = "milkdown";
    milkdown.appendChild(write);
    doc.body.appendChild(milkdown);
    // Canvas normalizes CSS colors, including named/modern color syntax.
    const canvas = doc.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const read = (value: string): RGB | null => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a === 255 ? [r, g, b] : null;
    };
    const background =
      [write, milkdown, doc.body, doc.documentElement]
        .map((el) => read(view.getComputedStyle(el).backgroundColor))
        .find((value): value is RGB => value !== null) ?? (dark ? INK : WHITE);
    const foreground = read(view.getComputedStyle(write).color) ?? INK;
    const accent = read(view.getComputedStyle(link).color) ?? [49, 94, 209];
    const palette: Record<string, string> = chromePalette(
      background,
      foreground,
      accent,
    );
    const documentStyle = view.getComputedStyle(write);
    // Typora themes often style body/#write without Textus variables. Supply
    // those variables for source view, code blocks and editor decorations too.
    for (const [key, fallback] of Object.entries({
      "--editor-bg": palette["--bg"],
      "--editor-text": palette["--chrome-text"],
      "--editor-muted": palette["--chrome-muted"],
      "--editor-accent": palette["--chrome-accent"],
      "--editor-border": palette["--border-color"],
      "--editor-code-bg": palette["--chrome-subtle"],
      "--editor-quote-border": palette["--chrome-accent"],
      "--editor-highlight-bg": palette["--sidebar-active"],
    })) {
      palette[key] = documentStyle.getPropertyValue(key).trim() || fallback;
    }
    // Typora themes size the text column with `#write { max-width }`, which our
    // column would otherwise cap. Published for the column while Text Width is
    // "Adaptive".
    const themeWidth = themeColumnWidth(documentStyle.maxWidth);
    if (themeWidth) palette["--theme-content-width"] = themeWidth;
    // A theme may name its own interface colours on :root; only the theme
    // sets variables in this frame, so whatever it names wins over the
    // derived value.
    const rootStyle = view.getComputedStyle(doc.documentElement);
    for (const key of Object.keys(palette)) {
      const own = rootStyle.getPropertyValue(key).trim();
      if (own) palette[key] = own;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `:root { ${Object.entries(palette)
      .map(([key, value]) => `${key}: ${value} !important;`)
      .join("\n")} }`;
    clearThemeChrome();
    document.head.appendChild(style);
    return style.textContent;
  } finally {
    frame.remove();
  }
}
