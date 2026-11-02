---
name: textus-theme
description: Author or modify a Textus editor theme - a Typora-compatible CSS file for the theme gallery (CatVinci-Studio/textus-themes) or that users import, or the default look. Use when adding a theme, changing theme colours, touching --doc-* / --sidebar-* / --ui-bg CSS variables, debugging why a theme only half-applies or looks wrong in dark mode, or working on the theme picker in Settings.
---

# Authoring a Textus theme

## The two things called "theme"

They are different mechanisms and the distinction decides everything else.

**The built-in look** is Textus's default (`src/theme/content-base.css` and the
`--doc-*` defaults in `src/ui/base.css`). Paper, Slate and Forest are built-in
palettes over it (`src/theme/content-themes.css`, three blocks each: light,
system dark, pinned dark; `--doc-*` only). Every other look is a theme in the
gallery (`textus-themes`) or a user's imported file. Parchment was withdrawn
in 1.3.2; a setting naming it falls back to the default.

**Imported themes** are arbitrary Typora-compatible CSS files a user picks in
Settings. They are read, inlined, and injected into a `<style>` tag at
runtime. They can style anything, and they are a user's file - not part of the
repo.

## Appearance and theme are orthogonal

Two independent settings compose into what the user sees:

| Setting   | Values                                                                 | Attribute on `<html>`                       |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `themeId` | `default`, or a user theme id                                          | none for `default`; `data-user-theme` for an imported theme |
| `theme`   | `system`, `light`, `dark`                                              | `data-theme` (**absent** for `system`)      |

There is no such thing as "a dark theme". Every theme must define both forms,
because the user can pick any combination. `system` deliberately removes
`data-theme` so the `@media (prefers-color-scheme: dark)` rules answer - which
is how the app follows an OS switch live, with no JS listener.

**Every content theme is therefore three blocks, in this order:**

```css
[data-content-theme="x"] {
  /* the light form, plus anything shared between both (fonts) */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])[data-content-theme="x"] {
    /* dark, for "follow system" */
  }
}

:root[data-theme="dark"][data-content-theme="x"] {
  /* dark, pinned - identical to the block above */
}
```

The two dark blocks are identical by construction. The base block is
unconditional, so the dark ones restate only what actually **changes**
(colours) and inherit the rest.

A theme with a single design still needs all three blocks - give the dark ones
the same values as the base. Otherwise switching appearance half-applies it:
dark chrome around light content.

## What a theme can define

### Content variables — what content themes set

Everything here is scoped to the writing area.

| Variable                | Controls                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--doc-bg`           | Editor background. Falls back to `--ui-bg`, so `default` leaves it unset.                                                                  |
| `--doc-text`         | Body text.                                                                                                                              |
| `--doc-muted`        | Secondary text: placeholders, counts, tool lines, most icons. The single most-used variable - it carries the app's whole "quiet" layer. |
| `--doc-accent`       | Links, the caret, focus rings, active states, accepted-edit highlights. The most visible colour in the app.                             |
| `--doc-border`       | Hairlines, table rules, input outlines.                                                                                                 |
| `--doc-code-bg`      | Inline code and code-block background.                                                                                                  |
| `--doc-quote-border` | The blockquote's leading rule.                                                                                                          |
| `--doc-highlight-bg` | `==marked==` text and find-match highlights. Defined in `App.css`; built-in content themes leave it alone.                              |
| `--doc-font`         | Content font stack. Only read once, as `var(--doc-font, var(--font-sans))`. Include CJK families - see _Gotchas_.                    |
| `--doc-list-gap`     | Vertical gap between list rows: the margin on an item's paragraph and on nested lists. Falls back to `0.4em` (tighter than prose).      |

### Chrome variables — NOT for content themes

`--ui-bg`, `--ui-subtle`, `--ui-text`, `--ui-hover`,
`--ui-selected`, `--ui-selected-text`, `--ui-border`, `--ui-danger`,
`--font-sans`. These are the window frame, derived from the `--doc-*`
colours in `ui/base.css` (`:root` / dark pair), so a theme that sets the
document's colours recolours the window too. `theme/theme-chrome.ts` derives
them for an imported theme that sets no variables, and a theme's own `:root`
may set any of them (`docs/design/design-language.md`, sections 3 and 14).

### Two more families, in `milkdown-theme.css`

`--doc-token-string`, `--doc-token-number`, `--doc-token-keyword`, `--doc-token-function`,
`--doc-token-tag` — code-block syntax highlighting.

`--doc-alert-note`, `--doc-alert-tip`, `--doc-alert-important`,
`--doc-alert-warning`, `--doc-alert-caution`, `--doc-alert-accent` — GitHub-style
alert blocks.

Both follow the same three-block light/dark structure. Built-in content themes
do not override them; a theme that wants its own syntax palette can.

### Revisions, in `design-system.css`

How a proposed AI revision is drawn in the document and its margin card
(`pending-edit-plugin.ts`, `milkdown-theme.css`). Defined on `:root` with a
light and a dark value; **Settings › Theme › Export** writes them out, so a
theme can set any of them.

| Variable                     | Controls                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--revision-insert-bg`       | The new text's tint.                                                                                         |
| `--revision-insert-text`     | The new text's colour. `currentColor`: the text's own.                                                       |
| `--revision-insert-hover-bg` | The new text's darker tint while its pair is under the pointer or the review bar's pointer, and in its card. |
| `--revision-delete-bg`       | The original's tint.                                                                                         |
| `--revision-delete-text`     | The original's colour - by default the text's own, faded.                                                    |
| `--revision-delete-strike`   | The line through the original.                                                                               |
| `--revision-delete-hover-bg` | The original's darker tint while its pair is under the pointer or the review bar's pointer, and in its card. |

Built-in content themes leave them alone: the tints follow `--ui-success`
and `--ui-danger`, which the dark palette already tunes.

## Adding a theme

New looks are gallery themes, not built-ins: one self-contained CSS file in
`textus-themes/themes/<id>/` with light and dark, following
`docs/design/design-language.md` section 14 - what a theme may change, what it
must provide, and, for a theme on a known palette, the nine `--tone-*`
variables so tags, charts and the graph use its colours. Port a famous theme by
reading its code for ideas and writing new CSS; don't copy code, and name it as
the original project's naming rules allow.

## Imported (Typora) themes

Users pick a `.css` file in Settings > Theme. `src/theme/theme-import.ts`
makes it self-contained before storing it:

- `@import` of a local file is **recursively inlined** (with a circular-import
  guard). Remote `@import`s are left as-is.
- Local `url(...)` assets - fonts, images - are **base64-inlined** as data
  URIs. Recognised extensions: woff2, woff, ttf, otf, png, jpg/jpeg, gif, svg,
  webp. A missing asset leaves the original reference rather than failing the
  import.
- Remote and `data:` URLs pass through untouched.

This is necessary because the CSS ends up in a runtime `<style>` tag with no
base URL, so nothing relative would resolve.

**Selectors that work.** The editor's ProseMirror root carries `id="write"`
specifically so community Typora themes apply without rewriting. Content also
sits under `.milkdown`. Target `#write` for Typora compatibility.

**Why a plain `blockquote {}` wins.** How document elements look (headings,
quotes, links, rules, code, list rhythm, tables) lives in
`src/editor/content-base.css`, inside `@layer textus-content`. Unlayered CSS
beats layered CSS regardless of specificity, so an imported theme's bare
element selectors override the built-in look. What makes the editor _work_
(list markers, carets, previews, table layout and resize handles) stays
unlayered in `milkdown-theme.css` so a theme can't break it. While an imported
theme is active, `<html>` carries `data-user-theme` and Textus's own ornaments
(h2 rule, h3 bar, h4 dot, tinted quote, accent hr) switch off, so a theme
looks the way it does in Typora. A new built-in _look_ rule belongs in
`content-base.css`; a new _behaviour_ rule in `milkdown-theme.css`.

**DOM differences bridged on import.** Code blocks carry Typora's
`md-fences` class. Milkdown has no `<thead>` (the header row is a
`<tr data-is-header>` in `<tbody>`), so `src/theme/typora-compat.ts`
rewrites `thead` selectors when the theme is applied.

**Imports are single-file**: `hasDark` is `false` for anything imported through
the UI, so the same stylesheet is used in both appearances - which is the right
behaviour for a one-design theme (see the rule above). The data model supports
a dark variant - `themes.saveThemeCss(id, "dark", css)` in `src/ipc.ts` - for
themes that ship one; the import UI only ever writes `"light"`.

## Gotchas

**Don't add a variable nothing defines.** Several `var(--x, fallback)` hooks
exist that no stylesheet ever sets, so only the fallback is ever used - they
look like theming points but aren't. Before introducing one, check it is
actually defined somewhere:

```
rg -o -- '--[a-z-]+\s*:' src --type css | sort -u    # defined
rg -o -- 'var\(--[a-z-]+' src --type css | sort -u   # used
```

**CJK fonts need naming explicitly.** `--doc-font` stacks must list CJK
families (`"Songti SC"`, `"Noto Serif CJK SC"`, ...) - a Latin-only stack
silently falls back to a system default for Chinese and Japanese text.

**Don't set `font-synthesis: none`.** `App.css` sets `font-synthesis: style`
on purpose: PingFang and Noto CJK ship no italic face, so without synthesis
`*emphasis*` on Chinese/Japanese renders upright. An imported theme that
turns synthesis off loses CJK italics entirely.

**`--doc-bg` is unset by default.** Consumers read
`var(--doc-bg, var(--ui-bg))`. If a theme sets it, make sure the dark form
sets it too, or dark mode will show a light editor on dark chrome.

**Contrast both ways.** A colour tuned against a light background usually
fails against the dark one. The dark blocks are separate values, not a
filter - check them.

## Verify

```
npx tsc --noEmit -p tsconfig.json
npx eslint src --max-warnings=0
npx vitest run
```

CSS itself is unchecked by any of these, so the theme has to be looked at:
run the app, then walk Settings > Theme through the new theme in light, dark,
and follow-system.
