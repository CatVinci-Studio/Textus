---
name: theme
description: >-
  Designs an editor theme from the user's description (mood, colours, fonts,
  a light or dark page) and writes it as one complete, self-contained CSS file
  in a css code block in the reply, ready to use or to share in the theme
  gallery; never edits the document. Use when asked to make, design or change a
  theme, colour scheme or look for the editor (主题/配色, テーマ, 테마, tema,
  thème, Design, тема).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-category: "format"
  textus-packs: "contract"
  textus-sources: "Our own text. The theme format is the app's own (Typora-compatible #write selectors); contrast ratios from WCAG 2.2 (W3C), summarised."
  textus-aliases-en: "theme-css, stylesheet"
  textus-aliases-zh: "设计主题, 主题, 编辑器主题"
  textus-aliases-zh-Hant: "設計主題, 主題, 編輯器主題"
  textus-aliases-ja: "テーマを作る, テーマ, テーマ作成"
  textus-aliases-ko: "테마 만들기, 테마"
  textus-aliases-es: "tema, diseñar-tema"
  textus-aliases-fr: "thème, créer-thème"
  textus-aliases-de: "design, farbschema"
  textus-aliases-ru: "тема, оформление"
  textus-aliases-pt: "tema, criar-tema"
---

# Design a theme

## Scope
- The look the user describes: mood, colours, fonts, a light or a dark page, a brand colour or a sample to match. The document is not the material: in every mode the theme goes in the reply, never into the document, and nothing is proposed or commented.
- When the request gives nothing to go on ("a theme"), ask one question: the mood or colours, and a light or a dark page. Otherwise choose and say what you chose.
- A theme is one design, shown the same in the app's light and dark appearance. When the user wants both a light and a dark version, write two themes, "Name Light" and "Name Dark", each complete in its own block.
- To change a theme from earlier in the conversation, write the whole file again with the change.

## The format
One CSS file the app loads after its own styles, Typora-compatible: `#write` is the document, `.milkdown` wraps it. In this order:
1. A first comment: `/* Name - one sentence on the look */`. The app names the theme from it.
2. `:root` with the variables the app reads for its own parts (source view, find, the window around the page):
   - `--editor-bg` the page; `--editor-text` body text; `--editor-muted` secondary text (placeholders, code comments, quiet labels);
   - `--editor-accent` links, the caret, focus rings, active states; `--editor-border` hairlines, table rules, outlines;
   - `--editor-code-bg` inline code and code blocks; `--editor-quote-border` the quote's rule; `--editor-highlight-bg` ==marked== text and find matches (keep the text readable on it);
   - `--editor-font` the text's font stack; optionally `--editor-list-gap` (space between list items, default 0.4em).
3. `body { background-color: var(--editor-bg); color: var(--editor-text); }`, for Typora.
4. `#write` with `color`, `font-family: var(--editor-font)`, `font-size` (16-18px or about 1.0625rem), `line-height` (1.6-1.9), and the page's own colours for code and alerts, so they read on this page in either appearance:
   - syntax: `--token-string`, `--token-number`, `--token-keyword`, `--token-function`, `--token-tag`, each readable on `--editor-code-bg`;
   - alerts: `--md-alert-note`, `--md-alert-tip`, `--md-alert-important`, `--md-alert-warning`, `--md-alert-caution`;
   - `color-scheme: dark` on a dark page.
5. Element rules, each under `#write`: `h1`-`h6` (sizes, weight, colour; the app's own heading rules, quote tint and rule marks switch off under an imported theme, so style what the design wants), `p`, `a` and `a:hover`, `strong`, `em`, `blockquote`, `code`, `pre` and `.md-fences` (code blocks), `pre code`, `table`, `th`, `td`, `hr`, `mark`, `img`, and `li::marker` if the markers take the accent.

The app's revision colours (the background on proposed new text, the background and strike line on deleted text, and the outline a revision shows on hover) follow the page by themselves. Leave them unless the user asks about them.

## Do
- Contrast (WCAG 2.2): body text at least 7:1 on `--editor-bg`; muted text, links and accents at least 4.5:1; code text and every token colour at least 4.5:1 on `--editor-code-bg`; borders visible but quiet (about 1.5:1 to 3:1). Choose values with a clear margin, and on a dark page avoid pure #000 and #fff.
- Fonts: system fonts with fallbacks, ending in a generic family; name CJK faces too ("Songti SC", "Noto Serif CJK SC", "Source Han Serif SC" for a serif; "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei" for a sans), or Chinese and Japanese fall back to a system default. Code in a monospace stack.
- Keep it short: a few KB, well under the gallery's 200 KB.
- Use hex or rgb() colours; comment a rule only where the reason isn't obvious.

## Don't
- `@import`, web fonts, or any `url()` that isn't a `data:` image or font (better: none). The app and the gallery load a theme as one file, offline.
- `expression()`, `javascript:` URLs, `behavior`, `-moz-binding`.
- Touch how the editor works: no `display`, `position`, `list-style-type`, `counter-*`, `caret-color: transparent`, `user-select` or `pointer-events` on document elements, and no `font-synthesis: none` (CJK italics need it).
- Style anything outside `#write`, `.milkdown`, `body` and `:root`: the app's sidebar, panels and menus take their colours from the theme by themselves.
- Use `!important`, except where a rule visibly loses without it.

## Deliver
- One line on the design (palette, fonts, light or dark page), then the whole theme in one ```css code block (two blocks only for a light and a dark version).
- Then how to use it, naming the app's controls as the user's UI names them:
  - Use this theme under the reply installs it and switches to it;
  - or save it as a .css file and import it with Settings > Editor & Appearance > Import CSS…; the theme menu there switches back.
- Then one line: they can share it in the theme gallery by posting it on https://github.com/CatVinci-Studio/textus-themes/issues/1 (a name, a one-sentence description, a license, the CSS and a screenshot).
- Nothing else after the block: no list of the colours again.
