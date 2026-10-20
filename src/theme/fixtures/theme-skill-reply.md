A dark page for night writing: blue-grey ink-dark paper, soft off-white text, a muted teal accent, and a bookish serif with Chinese serif faces named.

```css
/* Night Harbor - a calm dark page for night writing, with a muted teal accent */

:root {
  --editor-bg: #16191d;
  --editor-text: #dfe3e0;
  --editor-muted: #98a3a3;
  --editor-accent: #5fc4b4;
  --editor-border: #3a4147;
  --editor-code-bg: #1f2428;
  --editor-quote-border: #3f8f84;
  --editor-highlight-bg: rgba(95, 196, 180, 0.25);
  --editor-font:
    "Charter", "Iowan Old Style", "Palatino Linotype", Georgia, "Songti SC",
    "Noto Serif CJK SC", "Source Han Serif SC", serif;
}

body {
  background-color: var(--editor-bg);
  color: var(--editor-text);
}

#write {
  color: var(--editor-text);
  font-family: var(--editor-font);
  font-size: 1.0625rem;
  line-height: 1.8;
  color-scheme: dark;
  --token-string: #a5d6a7;
  --token-number: #f0b77a;
  --token-keyword: #c3a6ff;
  --token-function: #7fb8f0;
  --token-tag: #f19a9a;
  --md-alert-note: #7fb8f0;
  --md-alert-tip: #7fd1a0;
  --md-alert-important: #c3a6ff;
  --md-alert-warning: #e8b45c;
  --md-alert-caution: #f08c8c;
}

#write h1,
#write h2,
#write h3,
#write h4,
#write h5,
#write h6 {
  color: #f1f4f2;
  font-weight: 600;
  line-height: 1.3;
}

#write h1 {
  font-size: 2em;
}

#write h2 {
  font-size: 1.5em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--editor-border);
}

#write h3 {
  font-size: 1.25em;
  color: var(--editor-accent);
}

#write h4 {
  font-size: 1.1em;
}

#write h5,
#write h6 {
  font-size: 1em;
  color: var(--editor-muted);
}

#write a {
  color: var(--editor-accent);
  text-decoration: underline;
  text-decoration-color: rgba(95, 196, 180, 0.4);
  text-underline-offset: 0.2em;
}

#write a:hover {
  text-decoration-color: currentColor;
}

#write strong {
  color: #f1f4f2;
}

#write blockquote {
  margin-left: 0;
  padding: 0.1em 1em;
  border-left: 3px solid var(--editor-quote-border);
  color: #b4bdbb;
}

#write code {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background-color: var(--editor-code-bg);
  color: #8fd8cb;
  font-size: 0.9em;
}

#write pre,
#write .md-fences {
  background-color: var(--editor-code-bg);
  border: 1px solid var(--editor-border);
  border-radius: 8px;
}

#write pre code {
  padding: 0;
  background: transparent;
  color: var(--editor-text);
}

#write table {
  border-collapse: collapse;
}

#write th,
#write td {
  padding: 0.4em 0.8em;
  border: 1px solid var(--editor-border);
}

#write th {
  background-color: var(--editor-code-bg);
  color: #f1f4f2;
}

#write hr {
  border: 0;
  border-top: 1px solid var(--editor-border);
}

#write mark {
  background-color: var(--editor-highlight-bg);
  color: inherit;
}

#write li::marker {
  color: var(--editor-accent);
}
```

To use it, press **Use this theme** under this reply, or save it as `night-harbor.css` and import it with **Settings > Editor & Appearance > More themes > Import CSS…**. You can share it in the theme gallery by posting it on https://github.com/CatVinci-Studio/textus-themes/issues/1.
