# Textus design standard

The rules every surface of Textus is built to: the app, its official plugins, third-party plugins and themes. It is written to be followed by people and by AI agents without further explanation; where a rule needs a judgement, it says what to weigh.

## How to read this document

- **MUST**, **MUST NOT**: required. A change that breaks one is not merged.
- **SHOULD**, **SHOULD NOT**: the default. Departing from it needs a reason written in the pull request.
- **MAY**: allowed.
- Each section is marked **In force** (the code does this today; tests check what can be checked) or **Planned** (agreed, not built yet; don't depend on it until it is marked In force). A planned item names the work that makes it real.
- Values are given in CSS pixels at 100% Interface text size on the desktop. The phone's values follow in brackets where they differ.
- Code references are paths in this repository.

## 1. Principles

These are decision rules, used to settle cases the sections below don't cover.

1. **The document gets the most visual weight.** Interface chrome (bars, panels, menus) uses the UI font, small type roles, neutral colours and at most one accent colour on screen at a time. Colour, larger type and decoration belong to the document, where a theme sets them. When a control and the text compete for attention, reduce the control.
2. **One source for every surface.** The app, plugin pages and plugin popups read the same variables, the same component stylesheet and the same icon set. A component's look is defined once; nothing copies it.
3. **Prefer what Textus draws.** A plugin uses the app's lists, menus, dialogs, settings rows and status items before drawing its own page, and draws its own page only from the shared components (section 17).
4. **Themes own colour and document typography; this standard owns geometry.** Sizes, spacing, radii, elevation and motion are the same under every theme.
5. **Other products are references, not templates.** A pattern from another app is adopted only as a principle (its density, its order of interaction) and drawn with this standard's tokens and components. If the standard lacks something, the standard is extended first.
6. **Every rule that can be checked is checked** (section 18.3).

## 2. Tokens - In force (tiers and the `--tone-*` set: Planned)

### 2.1 Tiers

| Tier      | Prefix                                                                                                                                                 | Who may use it                           | Stability                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Reference | `--ref-*`                                                                                                                                              | The design system's own stylesheets only | Private; may change any time                                                                  |
| Role      | `--ui-*` (interface), `--doc-*` (document), `--text-*`, `--space-*`, `--shape-*`, `--control-height*`, `--dur-*`, `--ease-*`, `--shadow-*`, `--font-*` | The app, plugins, themes                 | **Public API.** Part of the plugin API version; renaming or removing one is a breaking change |
| Component | unprefixed or component-named custom properties inside one component's CSS (`--tag`)                                                                   | That component only                      | Private                                                                                       |

- Plugins and themes MUST use only role tokens. The list a plugin page receives is `src/plugins/views/theme-vars.ts`; a token not on that list does not exist inside a plugin page.
- A stylesheet outside `src/theme/` MUST NOT write a literal colour or shadow (`src/ui/theme-reach.test.ts`). Exceptions: a fallback inside `var()`, a mask (alpha only), a token mixed toward black or white with `color-mix()`, and Windows' caption buttons.

### 2.2 Naming new tokens

`--{scope}-{role}[-{modifier}][-{state}]`

- scope: `ui` (interface) or `doc` (document);
- role: `bg`, `surface`, `subtle`, `text`, `muted`, `border`, `accent`, `primary`, `danger`, `warning`, `success`, `tone`;
- modifier: `faint`, `strong`, `fill`, or a tone name;
- state: `hover`, `selected`, `disabled`, `focus`.

Existing names stay as they are. A new name MUST be built from this vocabulary; a word outside it needs this section amended first.

## 3. Colour - In force (3.4 tones: Planned)

### 3.1 Inputs and derivation

A theme sets the document's colours; the interface's are derived from them in `src/ui/base.css`, so one theme recolours the whole window:

| Input (theme sets) | Derived (interface)                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `--doc-bg`         | `--ui-bg`, `--ui-surface`, and the mixes below                                                         |
| `--doc-text`       | `--ui-text`; `--ui-border` = text 16% over bg; `--ui-subtle` = text 4% over bg; `--ui-hover` = text 7% |
| `--doc-muted`      | `--ui-muted`                                                                                           |
| `--doc-accent`     | `--ui-accent`; `--ui-selected` = accent 13%                                                            |

A theme MAY also set any `--ui-*` directly; its value wins over the derived one. Imported Typora themes that set no variables are sampled by `src/theme/theme-chrome.ts`.

### 3.2 One job per colour

Each interface colour has exactly one job. A new surface MUST pick its colours from this table; "which of these is it?" replaces "which grey?".

| Token                                         | Its only job                                                       |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `--ui-bg`                                     | The window's background                                            |
| `--ui-surface`                                | Raised surfaces: menus, popovers, cards, sheets                    |
| `--ui-subtle`                                 | Tinted regions: the sidebar, tracks, fills                         |
| `--ui-hover`                                  | A row or control under the pointer                                 |
| `--ui-selected`, `--ui-selected-text`         | A chosen row, tab or chip                                          |
| `--ui-border`                                 | Hairlines                                                          |
| `--ui-text` / `--ui-muted`                    | Text / secondary text                                              |
| `--ui-accent`                                 | The focus ring, links, the chosen item, a rule in force            |
| `--ui-accent-fill`, `--ui-on-fill`            | The accent as a fill (a checked box) and the label on it           |
| `--ui-primary`, `--ui-on-primary`             | The primary button: ink (text colour as fill, background as label) |
| `--ui-danger`, `--ui-warning`, `--ui-success` | Status only, never decoration                                      |
| `--doc-*`                                     | The document and anything that reads as part of it                 |

- The accent MUST NOT be used as a large fill or as the primary button. A primary button is ink (`--ui-primary`), so any theme recolours it and a dark theme gets a light button.
- Status colours MUST appear with an icon or text that says the same thing.

### 3.3 Contrast

- Body and secondary text MUST reach 4.5:1 against its background in every built-in theme, light and dark (3:1 for text 18 px and up). Lower emphasis is made with a lighter colour, never with `opacity` on text.
- `prefers-contrast: more` turns secondary colours into the text colour and thickens rings and hairlines; `forced-colors: active` gives cards and bars a `CanvasText` border.

### 3.4 Tones: categorical colours - Planned (work: tone tokens in `base.css`, passed to plugin pages)

Tags, board columns, graph groups, chart series, timelines and mind-map branches need several distinguishable colours. They MUST come from the tone set, never from a plugin's own palette or a library's default:

- `--tone-{gray|red|orange|yellow|green|teal|blue|purple|pink}`: the hue itself, for a dot, a line, a chart series;
- `--tone-{name}-text`: text in that hue, ≥ 4.5:1 on `--ui-bg`;
- `--tone-{name}-tint`: a background in that hue for chips and highlights.

Rules:

1. **The theme's palette comes first.** A theme with a signature palette (Dracula, Nord, Catppuccin, One Dark…) SHOULD set the tones from it, so everything in the window - tags, charts, the graph - speaks its colours. A theme that sets none gets tones derived from its five alert colours (`--doc-alert-note`, `-tip`, `-important`, `-warning`, `-caution`) and fixed hue angles, with lightness and chroma taken from its background and text.
2. **Order is fixed**: blue, green, orange, purple, red, teal, yellow, pink, gray. Series 1 and 2 always differ strongly. A plugin assigns tones in that order (an option's tone is its position among the property's options), not by hashing names.
3. Chart plugins MUST pass the tones to their library as its default palette, and the interface text, border and muted colours as its axis, grid and label colours.

## 4. Typography - In force

### 4.1 Two type systems, never mixed

|           | Font                                          | Owned by      | Used for                                                                                                     |
| --------- | --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Interface | `--font-sans` (system UI font), `--font-mono` | This standard | Menus, settings, bars, panels, plugin controls                                                               |
| Document  | `--doc-font`, `--doc-mono-font`               | The theme     | The user's writing, and anything a plugin draws as content in the document (a table's cells, a card's title) |

- Interface text MUST NOT use the document font. Document content MUST NOT use the interface type roles for its body text.

### 4.2 Interface type roles

Text names a role, never a size. Sizes are set in `src/ui/design-system.css` and follow **Interface text size** (`--ui-text-scale`, 90–125%).

| Role (`--text-…`) | Desktop | Phone | Line height | Weight  | Used for                                                                          |
| ----------------- | ------- | ----- | ----------- | ------- | --------------------------------------------------------------------------------- |
| `caption`         | 11      | 12    | 1.2         | 400/500 | Badges, counts, keycaps                                                           |
| `footnote`        | 12      | 13    | 1.4         | 400     | Hints, group titles, empty states                                                 |
| `secondary`       | 12      | 15    | 1.4         | 400     | Text beside the main text in a dense surface (a card, a list entry's second line) |
| `control`         | 13      | 15    | 1.2         | 400/500 | A control's label                                                                 |
| `body`            | 13      | 17    | 1.5         | 400     | The main text of a panel, menu, list or field                                     |
| `body-large`      | 14      | 17    | 1.5         | 400     | Main text where there is room: Settings' rows, dialogs                            |
| `title`           | 17      | 17    | 1.3         | 600     | A sheet's, panel's or navigation bar's title                                      |
| `large-title`     | 22      | 34    | 1.2         | 600     | A page's own title                                                                |

- Weights are 400, 500 and 600 only.
- The line heights and weights in the table are the rule for new work; they become tokens with the shared stylesheet (Planned, 15.3). Today the base sets 1.5 for text and 1.2 for controls.
- A size written in px instead of a role MUST be `calc(Npx * var(--ui-text-scale, 1))`, and a fixed box around text scales with it.
- CSS `zoom` MUST NOT be used for text size (WebKit leaves popovers and pointer coordinates unzoomed).

### 4.3 Document typography (theme guidance)

Themes SHOULD keep: a measure of 60–75 Latin characters (about 35–40 CJK characters); body line height 1.6–1.8; paragraph spacing about 0.8 line; headings with more space above than below. Table headers (and, in new themes, headings) MUST NOT break inside a CJK word (`word-break: keep-all`); table cells keep a minimum width of 3.5em.

## 5. Space, grid and layout - In force (5.4 templates: Planned for plugin pages)

### 5.1 The 4 px grid

Every radius, padding, margin, gap and component size MUST be a multiple of 4 px. Exceptions: 1–2 px hairlines and insets, and the document's own typography (themes, the editor's content, print). `src/ui/spacing-grid.test.ts` checks every stylesheet.

### 5.2 Spacing scale and use

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32.

| Between                                          | Use   |
| ------------------------------------------------ | ----- |
| An icon and its label; items of a chip group     | 4     |
| Controls in a row; rows of a dense list          | 8     |
| A panel's edge and its content; a card's padding | 12    |
| Groups in a panel or page                        | 16–24 |
| A dialog's edge and its content                  | 20–24 |

### 5.3 Control heights

Two heights: `--control-height` 28 (36) for forms, dialogs and a Settings row's select; `--control-height-sm` 24 (32) for bars, cards, segmented controls and tags. Each reaches a 44 pt touch target on the phone. There is no density setting.

### 5.4 Layout

**Window** (desktop): sidebar (resizable, 240–360) | document column | AI panel (resizable, 320–480). The document column centres the text at the theme's measure; the margin for review notes takes 280 on the right when shown. A tab's toolbar is 36 high.

**Surface templates.** A new surface - in the app or a plugin - MUST use one of these:

| Template              | Structure                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar panel         | 32-high title row (title, up to two circle icon buttons) → optional search field (capsule) → content (list rows 28 high) → empty state                         |
| Tab view              | 36-high toolbar (start: navigation and view switching; end: actions, the primary button last) → content on the document background                             |
| Block in the document | _Figure_ (a chart, a diagram): framed, centred, exported as a picture. _Record_ (a database): no frame (`frame: "none"`), a 32-high bar flush with the content |
| Settings page         | Declared settings, drawn by Textus; a custom page only with the settings group style                                                                           |
| Popup                 | Menus, selects, tooltips and dialogs are drawn by Textus (section 17.3)                                                                                        |

**Empty states** say in one sentence what will appear and how to get it, with at most one button, centred, in `footnote`.

## 6. Shape - In force

- **Containers** are rounded rectangles in three sizes: `--shape-l` 16 (dialogs, sheets, Settings), `--shape-m` 12 (cards, Settings' groups, menus, popovers, the AI composer, code blocks), `--shape-s` 8 (a box inside a card, a highlighted row, tooltips, multi-line fields). Nothing is rounder than its level; nothing is under `--shape-xs` 4.
- **Nesting** is concentric: a box inside another takes the outer radius less the padding between them (r = R − p). Boxes on one level share one radius. A large container keeps its radius and keeps its capsules at least one padding from its edge.
- **Controls** are capsules (`--shape-pill`): buttons, selects, one-line fields and search boxes, segmented controls (track and thumb), tabs, chips, tags and switches. A button with only an icon is a circle.
- **Character-level marks are square**: the caret, Vim's block cursor, the selection, find and flash highlights - radius 0–2 px.
- Where the engine supports it (Chromium 139+, so WebView2), container corners are continuous (`corner-shape: superellipse(1.25)`); capsules and circles stay `round`.

## 7. Elevation and materials - In force

| Level   | Look                                                                                      | Used for                                      |
| ------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| Flat    | No border, no shadow                                                                      | Regions of the window                         |
| Grouped | A `--ui-border` hairline, no shadow                                                       | Cards, board columns, tables, Settings groups |
| Overlay | `--ui-surface` + its one shadow (`--shadow-popover`, `--shadow-dialog`, `--shadow-sheet`) | Menus, popovers, dialogs, sheets              |

- Shadows MUST appear only on overlays, each paired with its surface.
- Blur materials are only for overlays with content scrolling underneath, and only on macOS and iOS (`<html data-platform>`). Overlays only darken what is under them; they never blur it.

## 8. Icons - In force (export to plugins by name: Planned)

- One set (`src/ui/icons.tsx`): stroked line art on a 16-unit grid, 1.4 stroke, round caps and joins, `currentColor`.
- Sizes follow the text role beside them: 16 with `body`, 14 with `secondary`, 12 with `caption`.
- A new icon is added to the set on the same grid and stroke; a surface MUST NOT draw a one-off icon for something the set has.
- Plugins name icons (`icon: "calendar"` in a list item; `<span class="tx-icon" data-icon="filter">` in a page - planned) instead of drawing their own.
- Emoji are content, not icons; the interface MUST NOT use emoji as icons.

## 9. States and focus - In force

- One rule for every control: hover `--ui-hover`; pressed one step stronger; selected `--ui-selected`; disabled 50% opacity.
- The focus ring shows only for keyboard focus (`:focus-visible`): the accent, 2 px (3 px with more contrast), drawn inside the control (`outline-offset: -1px`, `-2px` in a scrolling list).
- A highlight in a list or menu arrives in 80 ms and leaves at once, so a pointer running down a list leaves no trail.

## 10. Motion - In force

- Durations, curves, offsets and scales come only from `src/ui/motion.css`. `src/ui/motion-tokens.test.ts` fails on a new keyframe or a raw time elsewhere.
- Everything that moves is one of these moves: **enter** (`motion-enter`, `enter()`), **exit** (`motion-exit`, `exit()`), **mark** (`.motion-mark`, `land()`), **glide** (FLIP, `ui/flip.ts`), **beat** (`startBeat` / `enterOnBeat` / `joinBeat`: the parts of one change appear as one), **crossfade** (`crossfade()`), with **presence** (`ui/usePresence.ts`) keeping an element mounted while it exits.
- Durations: `--dur-instant` 80 ms (press, hover colour), `--dur-fast` 120 ms (small exits, fades), `--dur-base` 200 ms (menus, popovers, dialogs), `--dur-medium` 250 ms, `--dur-slow` 320 ms (sidebar, AI panel, Settings, Zen mode), `--dur-sheet` 450 ms (phone sheets). An exit takes about 70% of its entry. Loops (`--dur-blink`, `--dur-pulse`, `--dur-spin`, `--dur-sheen`, `--dur-drift`) are only for "working" indicators.
- Curves: `--ease-standard` (in place), `--ease-out` (entry), `--ease-in` (exit), `--ease-in-out` (movement), `--ease-spring-bouncy` (about 3% overshoot) only for a finger release.
- Only `opacity` and `transform` animate (`src/ui/motion-properties.test.ts`). Size changes use FLIP or a crossfade.
- Toggles (sidebar, panels, switches, arrows) use transitions so they can reverse; keyframes are only for one-time entries. An exiting element is `inert`; animations never block input.
- Space is consistent: a surface grows from its anchor and shrinks back into it, enters and leaves the same way, one direction per surface.
- Nothing moves while the user types: input, the caret, the selection, completions, typewriter scrolling, find highlights and counts change instantly.
- Under reduced motion, offsets and scales become 0, springs become the standard curve, slow motion becomes a 150 ms fade, loops stop and smooth scrolling is instant (`ui/motion.ts`: `prefersReducedMotion()`, `motionAllowed()`).

## 11. Components - In force (shared stylesheet for plugin pages: Planned)

| Component                | Rule                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons                  | Solid **primary** (ink, one per group), **secondary** (light border), **text** button for the next level down. One action appears as one button in one place. Size, radius and states are defined once in `design-system.css`; a component sets only layout and text colour |
| Icon button              | A 24 circle, no border in headers, toolbars and inline; named with `aria-label`, hinted with `ui/Tooltip.tsx`, never `title`                                                                                                                                                |
| Fields                   | One-line fields and search boxes are capsules; multi-line fields are `--shape-s` boxes. The focus ring is inside                                                                                                                                                            |
| Select                   | `ui/Select.tsx` with the drawn arrow, in the two control heights. Native dropdowns MUST NOT be used                                                                                                                                                                         |
| Checkbox                 | `.ui-check`: 15 px, `--shape-xs`, accent fill when checked                                                                                                                                                                                                                  |
| Switch                   | 1.5 times its row's text tall (em-based) on every platform and text size                                                                                                                                                                                                    |
| Segmented control / tabs | Capsule track and thumb; the chosen one `--ui-selected`                                                                                                                                                                                                                     |
| Tags, chips, badges      | Capsules at 20–24; tags take a tone (3.4); a chip shows a rule in force and opens it                                                                                                                                                                                        |
| Menus                    | The app menu, context menus, the project bar menu and the Quick Ask dropdown share one panel padding (4), one item size (4×8 padding, `body`), one hover, separators (1 px, 4×8 margin)                                                                                     |
| Dialogs                  | `ui/app-dialog.tsx` (`showMessage`, `showConfirm`); native alert and confirm MUST NOT be used                                                                                                                                                                               |
| Popups                   | All close with `useCloseOnOutsideClick`: a click outside or Esc closes them; the listener is active only while open                                                                                                                                                         |
| Tables                   | The document's own table look: a rounded frame (`--doc-radius`), a header tinted `--doc-code-bg`, `--doc-border` hairlines                                                                                                                                                  |
| Cards                    | Grouped level (section 7): hairline, no shadow, `--shape-m`                                                                                                                                                                                                                 |

Only the open and save file dialogs and the macOS system menu bar stay native.

## 12. Words in the interface - In force

- Group headings in Title Case ("Fixed Shortcuts"); row labels in sentence case ("Save automatically"); a menu item's own name as it is ("Source Mode").
- A switch is named by what it turns on, without "Enable" (except one that turns on a whole AI feature).
- A row's label says what the setting does on its own ("Show page numbers in exports", not "PDF page numbers" with a line under it).
- A "?" after a label (`ui/InfoTip.tsx`) is for a label that can't be understood without it and whose explanation matters (a trade-off between choices, outside setup). It shows on hover, click or tap, never as grey text under the row.
- What is live stays visible under the row: a value or a status.
- In Settings, a page's groups go from the most used to the least, links out last. A row that only means something with another setting on is hidden while it is off and comes right after it.
- Every string is localized (`src/i18n/`); interface text never hard-codes a language.

## 13. Accessibility - In force

- Every control has a name in the interface language; an icon-only button has `aria-label`.
- Landmarks: the window bar is `header`, the document column `main`, the sidebar and AI panel labelled `aside`s; the editor is a `textbox` named Document.
- Status that appears without focus moving goes through `announce()` (`src/ui/announce.ts`), one polite live region; no other live regions.
- Every action works from the keyboard. `F6` / `Shift+F6` move between regions (`src/app/regions.ts`); a list of like items is one tab stop walked with the arrow keys (trees, tab lists, menus).
- Esc closes the topmost surface only and returns focus to what opened it.
- Information never rests on colour alone.
- `e2e/a11y.spec.ts` runs axe-core over the main screens in light and dark and fails on serious or critical violations.

## 14. Themes - In force (14.3–14.5: Planned)

### 14.1 What a theme may change

- MAY: every `--doc-*` variable (colours, fonts, the document's typography), the interface inputs through them (3.1), any `--ui-*` colour, the tones (3.4), and `--revision-*` (how a proposed AI change is drawn).
- MUST NOT: sizes, spacing, radii, elevation, motion, or the editor's structure (the caret, the selection, revision marks, plugin block frames).
- A theme with only one colour scheme keeps it; it is not forced into dark.
- Remote `@import`, image backgrounds and layouts that depend on Typora's DOM are outside the compatibility promise.

### 14.2 What a theme MUST provide

- Light and dark appearances (one file each, or one file with `prefers-color-scheme`), unless it is single-scheme by design and says so.
- Text, secondary text, links and code reaching section 3.3's contrast against `--doc-bg` and `--doc-code-bg`.
- A tested look for: headings 1–6, paragraphs in Latin and CJK, emphasis, links, quotes, lists and task lists, inline code and code blocks, tables, callouts, math, footnotes, horizontal rules, highlights and images.

### 14.3 Signature palettes

A theme built on a known palette (Dracula, Nord, Catppuccin, Gruvbox, One Dark, Solarized, Tokyo Night, Rosé Pine, Flexoki…) SHOULD set the tones (3.4) from that palette, so plugins - tags, charts, the graph - use its colours. It MUST credit the palette and follow its license and naming policy.

### 14.4 Previews

Every theme's preview is drawn from one fixed sample document (Latin and CJK text, heading levels, quote, list, task list, code, table, callout), in light and dark, at 1280×800, so themes are compared on the same content.

### 14.5 The official set

The official gallery keeps one theme per distinct character (a calm default, warm paper for reading, academic paper, typewriter manuscript, monospace, rich heading hierarchy, card sections, compact, high contrast, and well-known palettes). A theme that differs from another mainly by its accent colour SHOULD be merged into it. A theme withdrawn from the list stays installable for those who have it.

## 15. Plugins - In force (15.3–15.4: Planned)

### 15.1 Tiers, most preferred first

1. **Declared**: commands, menu items, `/` items, key bindings, status items, settings.
2. **Drawn by Textus**: lists and trees (`views.registerList`), dialogs (`ui.message`, `confirm`, `input`, `pick`, `form`), hover cards, editor decorations.
3. **A page of the plugin's, built from the shared components**, with popups drawn by Textus.
4. **Free drawing** (a chart library, a PDF, a canvas): colours from the tones and interface tokens; the bars and buttons around it from tier 3.

A plugin MUST use the lowest tier that can do the job.

### 15.2 Rules for every plugin page (tiers 3–4)

- Colours, sizes and fonts only from the role tokens; no literal colours, no px font sizes, no own font families.
- The plugin follows the current theme's colours, tones included, so a Dracula window gets Dracula tags and charts. It has no brand colour of its own.
- It fits one of the surface templates (5.4).
- Every control has a name; the page works from the keyboard.
- A code block page reports its content height (the runtime does this) and never sizes itself to 100% of its frame.

### 15.3 Shared components for plugin pages - Planned (work: one framework-free stylesheet)

One stylesheet of `tx-` classes (buttons, icon buttons, fields, select, checkbox, switch, segmented control, tabs, tags, chips, list rows, tables, cards, empty state, bars, settings rows), used by the app's own React components and injected unchanged into every plugin page. No React or other framework kit is offered to plugins.

### 15.4 Popups drawn by Textus - Planned (work: plugin API)

`api.menu(items, { at })` (context and dropdown menus), `api.select(...)` and `data-tooltip` let a plugin page open Textus's own menus, selects and tooltips, so they look, move and respond to keys as the app's do. A plugin page MUST NOT draw its own menu once these exist.

## 16. Front-end architecture - In force (16.2 layout: Planned)

### 16.1 Layers

Dependencies point one way: **tokens → styles → components → patterns → features**. A layer never re-defines a value an earlier layer defines, and never imports from a later one.

| Layer      | Today                                                                                   | Holds                                   |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| Tokens     | `src/ui/base.css`, `design-system.css` (variables), `motion.css`                        | Role tokens and their derivation        |
| Styles     | `src/ui/design-system.css` (controls, states), `src/plugins/host/runtime/plugin-ui.css` | Control looks and states, once          |
| Components | `src/ui/*.tsx` (`Select`, `Tooltip`, `ContextMenu`, `app-dialog`, `InfoTip`, `icons`)   | React wrappers; no own colours or sizes |
| Patterns   | Settings rows, the sidebar, menus, the command palette                                  | Arrangements of components              |
| Features   | `src/editor`, `src/ai`, `src/sidebar`, `src/settings`, `src/plugins`…                   | Compose the layers above                |

### 16.2 Target layout - Planned

```
src/ui/tokens/      the token source -> tokens.css, the plugin token list, the docs table
src/ui/styles/      textus-ui.css: base, states, tx-* components, surface templates
src/ui/icons/       the icon set and its public name list
src/ui/components/  React components over tx-* classes
src/ui/patterns/    sidebar panel, settings page, dialogs, menus, command palette
src/plugins/host/   injects tokens, styles and icons into plugin pages; bridges popups
```

Files move there as they are touched, not in one rewrite.

### 16.3 Enforcement

- In force: `spacing-grid.test.ts`, `theme-reach.test.ts`, `motion-tokens.test.ts`, `motion-properties.test.ts`, `style-invalidation.test.ts`, `e2e/a11y.spec.ts`, the contrast tests in `src/theme/content-themes.test.ts` and `theme-chrome.test.ts`.
- Planned: a Stylelint configuration banning literal colours, px font sizes, off-grid spacing, raw radii and raw durations, run on the app and official plugins and offered to third-party authors; the plugin listing review warns on a page that breaks it; a test that every public token resolves in every built-in theme; a component gallery page in dev mode, drawn in the current theme, that is also the visual regression target.

## 17. Review checklist

Before a change to the interface, a plugin page or a theme is merged:

- [ ] Every colour, size, radius, space, duration and font is a token (2, 3, 4, 5, 6, 10).
- [ ] Colours are taken by their job (3.2); categorical colours are tones (3.4); the primary button is ink.
- [ ] Type uses roles; the interface and document fonts are not mixed (4).
- [ ] The surface uses a template (5.4); controls use the two heights (5.3).
- [ ] Containers are concentric; controls are capsules; character marks are square (6).
- [ ] Only overlays have shadows (7).
- [ ] Icons come from the set (8).
- [ ] Hover, selected, disabled and focus follow section 9; the page works from the keyboard (13).
- [ ] Motion uses the moves and tokens; nothing moves while typing (10).
- [ ] Words follow section 12 and are localized.
- [ ] Light and dark, the five built-in themes, and one imported theme were looked at; a plugin page also in one signature-palette theme.
