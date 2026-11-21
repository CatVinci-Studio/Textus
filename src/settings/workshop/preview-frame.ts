import { drawPreview } from "../../editor/preview-editor";
import { katexFirstLoad } from "../../editor/math/katex-loader";
import { cloneEditorContent, nextFrame } from "../../export/standalone-html";
import { CHROME_STYLE_ID, themeChromeCss } from "../../engine/tokens/palette";
import { withCurrentVariables } from "../../theme/legacy-variables";
import { adaptTyporaCss } from "../../theme/typora-compat";
import {
  CUSTOM_CSS_STYLE_ID,
  PLUGIN_COLORS_STYLE_ID,
  USER_THEME_STYLE_ID,
} from "../../theme/style-ids";
import type { Settings } from "../../prefs/SettingsContext";
import type { ThemeCss } from "../../theme/builtin-base";
import type { FontStacks, TypeMeasure } from "../../theme/theme-typography";

/** One fixed page every theme is judged on: each heading level, Latin and
 *  CJK text, a list, a quote, code, a table and a formula. */
const SAMPLE = `# 春江花月夜 The River in Spring

The quick brown fox jumps over the lazy dog. Good type is invisible: the reader sees words, not *letters*, and **reading** goes on without effort.

春江潮水连海平，海上明月共潮生。滟滟随波千万里，何处春江无月明！江流宛转绕芳甸，月照花林皆似霰。

## 排版的几个要素 Elements

- 字体与字号 Typeface and size
- 行高与行宽 Leading and measure
- 段落间距 Paragraph spacing

> 文章合为时而著，歌诗合为事而作。
> Form follows function.

### 代码与公式 Code and math

\`\`\`js
function measure(text, width) {
  return Math.round(width / text.length);
}
\`\`\`

| 要素 Element | 常用值 Common |
| --- | --- |
| 行高 Leading | 1.6–1.8 |
| 行宽 Measure | 35–40 字 / 60–75 chars |

$$
E = mc^2, \\quad \\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`;

/** The page's own stylesheets, less what the theme in use and the reader
 *  put there: those would show the theme in use, not the one built. */
const LEFT_OUT = new Set([
  USER_THEME_STYLE_ID,
  CHROME_STYLE_ID,
  CUSTOM_CSS_STYLE_ID,
  PLUGIN_COLORS_STYLE_ID,
]);

/** The frame's page: the document's paper, scrolling as one. */
const FRAME_CSS = `body { background: var(--doc-bg, var(--ui-bg)); color: var(--doc-text); }`;

/** The sample drawn once by the editor itself, off screen, and kept as its
 *  page's HTML: the frame shows the editor's real blocks without running
 *  one. */
export async function sampleHtml(
  settings: Settings,
  label: string,
): Promise<string> {
  await katexFirstLoad();
  const host = document.createElement("div");
  host.className = "theme-workshop-draw";
  document.body.append(host);
  try {
    const preview = await drawPreview(
      host,
      SAMPLE,
      null,
      () => label,
      { current: { ...settings, enableMath: true, codeLineNumbers: false } },
      true,
    );
    // Code is coloured and formulas drawn a frame or two after.
    await nextFrame();
    await nextFrame();
    const page = host.querySelector(".milkdown") ?? host;
    const html = cloneEditorContent(page);
    preview.destroy();
    return html.replace(/ role="textbox"| aria-multiline="true"/g, "");
  } finally {
    host.remove();
  }
}

/** Every rule the window's own stylesheets hold, less the left-out ones. */
function appCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (owner && LEFT_OUT.has(owner.id)) continue;
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // A sheet from elsewhere can't be read; the app has none.
    }
  }
  return parts.join("\n");
}

function styleIn(doc: Document, id: string): HTMLStyleElement {
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = id;
    doc.head.append(style);
  }
  return style;
}

/** Fills an empty frame: the app's stylesheets, then the slots for the
 *  starting theme, its chrome and the workshop's rules, in that order. */
export function setUpFrame(doc: Document, html: string): void {
  const root = document.documentElement;
  for (const name of ["lang", "data-early-containers"]) {
    const value = root.getAttribute(name);
    if (value !== null) doc.documentElement.setAttribute(name, value);
  }
  doc.documentElement.setAttribute("data-user-theme", "");
  // As rule text, not cloned <link>s: a built app's sheets would load in
  // the frame only after it was first measured.
  styleIn(doc, "workshop-app").textContent = appCss();
  styleIn(doc, "workshop-frame").textContent = FRAME_CSS;
  for (const id of ["workshop-base", "workshop-chrome", "workshop-rules"])
    styleIn(doc, id);
  doc.body.className = document.body.className;
  doc.body.innerHTML = `<div class="editor-content">${html}</div>`;
}

/** Shows the starting theme as apply-appearance.ts shows an imported one:
 *  its dark file in dark if it has one, otherwise its one page in light. */
export function showBase(
  doc: Document,
  css: string,
  dark: boolean,
  hasDark: boolean,
): void {
  const root = doc.documentElement;
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  root.toggleAttribute("data-light-page", dark && !hasDark);
  const adapted = withCurrentVariables(css);
  styleIn(doc, "workshop-base").textContent = adaptTyporaCss(adapted);
  styleIn(doc, "workshop-chrome").textContent =
    themeChromeCss(adapted, dark && hasDark) ?? "";
}

/** The window's colours each of a theme's files implies, as applying it
 *  would derive them: what a page palette must leave as they are. */
export function chromePins(base: ThemeCss): {
  light: string | null;
  dark: string | null;
} {
  return {
    light: themeChromeCss(withCurrentVariables(base.light), false),
    dark: base.dark
      ? themeChromeCss(withCurrentVariables(base.dark), true)
      : null,
  };
}

export function showRules(doc: Document, css: string): void {
  styleIn(doc, "workshop-rules").textContent = css;
}

const px = (value: string) => parseFloat(value) || 0;

/** The starting theme's own measures and faces, read off the frame with
 *  no workshop rules over it. */
export function measureFrame(doc: Document): {
  measures: Record<TypeMeasure, number | null>;
  stacks: FontStacks;
} | null {
  const view = doc.defaultView;
  const write = doc.getElementById("write");
  if (!view || !write) return null;
  const style = (selector: string) => {
    const el = write.querySelector(selector);
    return el ? view.getComputedStyle(el) : null;
  };
  const page = view.getComputedStyle(write);
  const size = px(page.fontSize);
  const h3 = style("h3");
  const p = style(":scope > p");
  const code = style("pre code") ?? style("code");
  const width = /px$/.test(page.maxWidth) ? px(page.maxWidth) : null;
  const leading =
    page.lineHeight === "normal" ? 1.2 : px(page.lineHeight) / (size || 1);
  return {
    measures: {
      fontSize: size || null,
      headingRatio: h3 && size ? px(h3.fontSize) / size : null,
      lineHeight: leading,
      width,
      paragraphGap: p ? px(p.marginBottom) / (px(p.fontSize) || 1) : null,
      indent: p ? px(p.textIndent) / (px(p.fontSize) || 1) : null,
    },
    stacks: {
      body: page.fontFamily,
      heading: h3?.fontFamily ?? page.fontFamily,
      code: code?.fontFamily ?? "monospace",
    },
  };
}
