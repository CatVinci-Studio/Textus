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

## 2. Tokens - In force (the `--ref-*` tier: Planned)

### 2.1 Tiers

| Tier      | Prefix                                                                                                                                                 | Who may use it                           | Stability                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Reference | `--ref-*`                                                                                                                                              | The design system's own stylesheets only | Private; may change any time                                                                  |
| Role      | `--ui-*` (interface), `--doc-*` (document), `--text-*`, `--space-*`, `--shape-*`, `--control-height*`, `--dur-*`, `--ease-*`, `--shadow-*`, `--font-*` | The app, plugins, themes                 | **Public API.** Part of the plugin API version; renaming or removing one is a breaking change |
| Component | unprefixed or component-named custom properties inside one component's CSS (`--tag`)                                                                   | That component only                      | Private                                                                                       |

- Plugins and themes MUST use only role tokens. The list a plugin page receives is `src/plugins/views/theme-vars.ts`; a token not on that list does not exist inside a plugin page.
- A stylesheet outside `src/theme/` MUST NOT write a literal colour or shadow (`src/engine/controls/theme-reach.test.ts`). Exceptions: a fallback inside `var()`, a mask (alpha only), a token mixed toward black or white with `color-mix()`, and Windows' caption buttons.

### 2.2 Naming new tokens

`--{scope}-{role}[-{modifier}][-{state}]`

- scope: `ui` (interface) or `doc` (document);
- role: `bg`, `surface`, `subtle`, `text`, `muted`, `border`, `accent`, `primary`, `danger`, `warning`, `success`, `tone`;
- modifier: `faint`, `strong`, `fill`, or a tone name;
- state: `hover`, `selected`, `disabled`, `focus`.

Existing names stay as they are. A new name MUST be built from this vocabulary; a word outside it needs this section amended first.

## 3. Colour - In force

### 3.1 Inputs and derivation

A theme sets the document's colours; the interface's are derived from them in `src/engine/tokens/base.css`, so one theme recolours the whole window:

| Input (theme sets) | Derived (interface)                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `--doc-bg`         | `--ui-bg`, `--ui-surface`, and the mixes below                                                         |
| `--doc-text`       | `--ui-text`; `--ui-border` = text 16% over bg; `--ui-subtle` = text 4% over bg; `--ui-hover` = text 7% |
| `--doc-muted`      | `--ui-muted`                                                                                           |
| `--doc-accent`     | `--ui-accent`; `--ui-selected` = accent 13%                                                            |

A theme MAY also set any `--ui-*` directly; its value wins over the derived one. Imported Typora themes that set no variables are sampled by `src/engine/tokens/palette.ts`.

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
| `--ui-accent`                                 | The focus ring, the chosen item, a rule in force (as a mark)       |
| `--ui-accent-text`, `--doc-accent-text`       | The accent as words: links, a chosen label (a step towards text)   |
| `--doc-mark`                                  | "Here" and "now": highlights, find matches, review notes           |
| `--ui-accent-fill`, `--ui-on-fill`            | The accent as a fill (a checked box) and the label on it           |
| `--ui-primary`, `--ui-on-primary`             | The primary button: ink (text colour as fill, background as label) |
| `--ui-danger`, `--ui-warning`, `--ui-success` | Status only, never decoration                                      |
| `--doc-*`                                     | The document and anything that reads as part of it                 |

- The accent MUST NOT be used as a large fill or as the primary button. A primary button is ink (`--ui-primary`), so any theme recolours it and a dark theme gets a light button.
- Status colours MUST appear with an icon or text that says the same thing.

### 3.2a One palette

The default theme is Apple's system palette (Textus 1.3.13). A theme gives base colours - paper, ink, muted, line, accent, mark and the tones - and everything else is derived from them at fixed ratios: frames, selections, highlights (mark over paper), alerts (note = accent, tip = green, important = purple, warning = mark, caution = red), syntax tokens, find matches, review notes. A colour used as words steps towards the text so a bright base colour still reads. No surface MAY keep a palette of its own.

### 3.3 Contrast

- Body and secondary text MUST reach 4.5:1 against its background in every built-in theme, light and dark (3:1 for text 18 px and up). Lower emphasis is made with a lighter colour, never with `opacity` on text.
- `prefers-contrast: more` turns secondary colours into the text colour and thickens rings and hairlines; `forced-colors: active` gives cards and bars a `CanvasText` border.

### 3.4 Tones: categorical colours - In force (Textus 1.3.2)

Tags, board columns, graph groups, chart series, timelines and mind-map branches need several distinguishable colours. They MUST come from the tone set, never from a plugin's own palette or a library's default:

- `--tone-{gray|red|orange|yellow|green|teal|blue|purple|pink}`: the hue itself, for a dot, a line, a chart series;
- `--tone-{name}-text`: text in that hue, ≥ 4.5:1 on `--ui-bg`;
- `--tone-{name}-tint`: a background in that hue for chips and highlights.

Rules:

1. **The theme's palette comes first.** A theme with a signature palette (Dracula, Nord, Catppuccin, One Dark…) SHOULD set the tones from it, so everything in the window - tags, charts, the graph - speaks its colours. A theme that sets none gets the defaults in `src/engine/tokens/base.css`: fixed hues at one lightness for light appearances and another for dark. The `-text` and `-tint` forms are derived from the tone (mixed toward `--ui-text`, and 16% over the background), so a theme sets only the nine `--tone-{name}` values.
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

Text names a role, never a size. Sizes are set in `src/engine/tokens/design-system.css` and follow **Interface text size** (`--ui-text-scale`, 90–125%).

| Role (`--text-…`) | Desktop | Phone | Line height | Weight  | Used for                                                                          |
| ----------------- | ------- | ----- | ----------- | ------- | --------------------------------------------------------------------------------- |
| `caption`         | 12      | 12    | 1.2         | 400/500 | Badges, counts, keycaps                                                           |
| `footnote`        | 12      | 13    | 1.4         | 400     | Hints, group titles, empty states                                                 |
| `list`            | 13      | 17    | 1.35        | 400     | A long list read at a glance (the file tree)                                      |
| `secondary`       | 14      | 15    | 1.4         | 400     | Text beside the main text in a dense surface (a card, a list entry's second line) |
| `control`         | 14      | 15    | 1.2         | 400/500 | A control's label                                                                 |
| `body`            | 14      | 17    | 1.5         | 400     | The main text of a panel, menu, list or field                                     |
| `body-large`      | 14      | 17    | 1.5         | 400     | Main text where there is room: Settings' rows, dialogs                            |
| `title`           | 18      | 17    | 1.3         | 600     | A sheet's, panel's or navigation bar's title                                      |
| `large-title`     | 24      | 34    | 1.2         | 600     | A page's own title                                                                |

- `--text-mark` (9) is not a text size: the digit in a count badge or a numbered mark.
- Weights are 400, 500 and 600 only.
- The line heights and weights in the table are the rule for new work; they become tokens later (Planned). Today the base sets 1.5 for text and 1.2 for controls.
- A size written in px instead of a role MUST be `calc(Npx * var(--ui-text-scale, 1))`, and a fixed box around text scales with it.
- CSS `zoom` MUST NOT be used for text size (WebKit leaves popovers and pointer coordinates unzoomed).

### 4.3 Document typography (theme guidance)

The document's size and spacing are two variables: `--doc-font-size` (default: 16.5 px at the standard measure, growing to 18 px as the column widens) and `--doc-line-height` (default 1.8). A theme MAY set them. The reader's **Settings › Editor & Appearance › Document text size** and **Line spacing** (14–24 px; compact 1.55, standard 1.8, relaxed 2.05) set them on the root and win over every theme, an imported one included. Headings and other elements MUST be sized in `em` from the body so they follow.

Themes SHOULD keep: a measure of 60–75 Latin characters (about 35–40 CJK characters); body line height 1.6–1.8; paragraph spacing about 0.8 line; headings with more space above than below. Table headers (and, in new themes, headings) MUST NOT break inside a CJK word (`word-break: keep-all`); table cells keep a minimum width of 3.5em.

## 5. Space, grid and layout - In force (5.4 templates: Planned for plugin pages)

### 5.1 The 4 px grid

Every radius, padding, margin, gap and component size MUST be a multiple of 4 px. Exceptions: 1–2 px hairlines and insets, and the document's own typography (themes, the editor's content, print). `src/engine/controls/spacing-grid.test.ts` checks every stylesheet.

### 5.2 Spacing scale and use

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-6` 24 · `--space-8` 32. (`--space-5` is kept for plugins and draws 24.) `scripts/check-design-values.mjs` (in `npm run check`) fails on spacing off this scale, a radius not from `--shape-*` and a blurred shadow not from `--shadow-*`; a line that must differ says why with `design: allow`.

| Between                                          | Use   |
| ------------------------------------------------ | ----- |
| An icon and its label; items of a chip group     | 4     |
| Controls in a row; rows of a dense list          | 8     |
| A panel's edge and its content; a card's padding | 12    |
| Groups in a panel or page                        | 16–24 |
| A dialog's edge and its content                  | 24    |

### 5.3 Control heights

Two heights: `--control-height` 28 (36) for forms, dialogs and a Settings row's select; `--control-height-sm` 24 (32) for bars, cards, segmented controls and tags. Each reaches a 44 pt touch target on the phone. There is no density setting.

### 5.4 Layout

**Window** (desktop): sidebar (resizable, 198–528, 264 to start) | document column | AI panel (resizable, 330–792, 440 to start). Widths are kept in base units and drawn times `--chrome-scale` (5.6); each panel takes at most 45% of the window and leaves the document at least 360 × scale, the AI panel counting an open sidebar. The document column centres the text at the theme's measure; the margin for review notes takes 280 on the right when shown. A tab's toolbar is 36 high.

**Surface templates.** A new surface - in the app or a plugin - MUST use one of these:

| Template              | Structure                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar panel         | 32-high title row (title, up to two circle icon buttons) → optional search field (capsule) → content (list rows 28 high) → empty state                         |
| Tab view              | 36-high toolbar (start: navigation and view switching; end: actions, the primary button last) → content on the document background                             |
| Block in the document | _Figure_ (a chart, a diagram): framed, centred, exported as a picture. _Record_ (a database): no frame (`frame: "none"`), a 32-high bar flush with the content |
| Settings page         | Declared settings, drawn by Textus; a custom page only with the settings group style                                                                           |
| Popup                 | Menus, selects, tooltips and dialogs are drawn by Textus (5.5)                                                                                                 |

**Empty states** say in one sentence what will appear and how to get it, with at most one button, centred, in `footnote`.

### 5.5 Surfaces - In force (Textus 1.3.9)

Every surface that appears in the window is one of these. Each row says where it sits, when it comes and goes, what it may hold, and the one thing to use for it. A new surface takes a row; if none fits, this table is extended first - never a new box.

| Surface                                                                                                  | Where                                                                                         | Comes and goes                                                                                                                       | May hold                                                                                                                                                                      | Use                                                                                                                                                                                                                                | Must not                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Window regions: title bar (with status items), tab bar, sidebar panel, tab view, AI panel, review margin | Fixed regions, flat                                                                           | Always, or toggled by the user                                                                                                       | Their own bars and lists; status items as buttons                                                                                                                             | Sidebar: `views.registerList` or a webview; tab view: `layout.openView`; status: `ui.setStatusItem` (a plugin with several items gets one button opening `useMenuButton`)                                                          | Shadows; a header row of their own making (icon buttons are `engine/controls/IconButton.tsx`)              |
| Corner card                                                                                              | Bottom right (`CornerStack corner="end"`), bottom left for start-up notes, `--z-toast`        | Something to act on: an update, a plugin suggestion, drafts brought back. Stays until answered; never takes the focus                | One line, at most two buttons (one primary), ×, optional details opened from the line                                                                                         | `engine/controls/CornerToast.tsx` (`CornerToast` in a `CornerStack`); plugins only through `textus.offerPlugin`                                                                                                                    | Closing itself; a second card style                                                                        |
| Note                                                                                                     | Bottom centre, `--z-toast`                                                                    | Says something and goes by itself (4.5 s, 12 s with an action); a pointer resting on it holds it; the same note said again stays one | Text, its source, at most one action, or a progress bar with Cancel                                                                                                           | `showNotice`, `startProgress` (`engine/controls/notices.tsx`); plugins `ui.notice`, `ui.progress*`                                                                                                                                 | A note system of its own                                                                                   |
| Bar over the document                                                                                    | Find bar (top end), review bar (bottom centre)                                                | While its task lasts; Escape closes the find bar                                                                                     | Fields and pill buttons                                                                                                                                                       | Their components                                                                                                                                                                                                                   | Blur (7)                                                                                                   |
| Popover                                                                                                  | Next to what opened it, `--z-popover`; menus `--z-menu`                                       | Hover, a click or a key; a press outside or Escape closes it (not while an input method composes)                                    | Menu rows (`ContextMenu`, at the pointer or hung from a button with `useMenuButton`); a select (`Select`); a typing list (the `/` panel); a hover card; an InfoTip or Tooltip | `.floating-surface` for the box; `useCloseOnOutsideClick` for closing; `engine/controls/placement.ts` (`clampLeft`, `clampTop`, `opensBelow`) or `usePlacement` for placing                                                        | Its own border, radius, background or shadow; its own outside-click or Escape listener; a hard-coded layer |
| Dialog                                                                                                   | Centred over a dimmed window, `--z-modal` (`--z-alert` for one that must be answered first)   | Asks and waits; Escape and the dimming cancel                                                                                        | A title, a message or fields, buttons at the end (primary last)                                                                                                               | `showMessage`, `showConfirm`, `showPrompt` (`engine/controls/app-dialog.tsx`), `showPluginForm` for fields; a dialog of its own takes the `.close-prompt` box; plugins `ui.message/confirm/input/form`; `showQuickPick` for a list | Native `alert`, `confirm` or `<select>`; a box of its own                                                  |
| Phone sheet                                                                                              | From the bottom edge, `--z-sheet`                                                             | What a menu (`ActionSheet`) or a popover card (`BottomCard`) becomes on a phone; a tap outside or Escape closes it                   | Rows, or content and two big buttons                                                                                                                                          | `engine/controls/Sheet.tsx` with its two bodies                                                                                                                                                                                    | Its own dimming, motion or Escape                                                                          |
| AI panel and Quick Ask                                                                                   | The AI panel beside the document (or its own window); Quick Ask under the paragraph or docked | Opened by the user; Escape in Quick Ask asks to close                                                                                | One `ChatBody` (messages and composer) shared by both, a header of `IconButton`s, the pending-edits bar                                                                       | `ai/chat/ChatBody`, `IconButton`; plugins add tools and skills, not panels                                                                                                                                                         | A second message list or composer                                                                          |
| Floating view                                                                                            | Over the document, `--z-floating`                                                             | Opened by a plugin; moved, folded to a dot and closed by the user                                                                    | A plugin's page                                                                                                                                                               | `layout.openFloating`                                                                                                                                                                                                              | Covering a popover or a dialog                                                                             |

**Layers**, low to high: `--z-bar` (45) bars → `--z-floating` (200) floating views → `--z-popover` (250) popovers, hover cards, the tutorial → `--z-toast` (300) corner cards, notes, the find bar → `--z-menu` (310) menus → `--z-modal` (400) Settings and dialogs → `--z-alert` (450) dialogs that must be answered → `--z-sheet` (500) phone sheets → `--z-select` (1000) a select's list. A surface MUST take its layer from these tokens.

**Escape** closes one thing, the innermost: a popover or menu, then a sheet, then a dialog, then the find bar or Quick Ask, then Zen Mode. While an input method is composing, Escape belongs to it.

**Lists you type into** (the `/` panel, the command palette, the file search, the chat's `/` and `@`) filter with `utils/list-filter.ts`: a label starting with the query first, then a word starting with it, inside it, every word, then pinyin. The option the keys are on is selected (9).

### 5.6 Sizes and scale - In force (Textus 1.3.12)

Every size in the interface is written once, in **interface pixels** on the 4 px grid, and drawn at the interface's size. Nothing - the app, a plugin, a script - draws a fixed number of screen pixels.

**The scale.** Interface Size has three presets, Small, Medium and Large, as Chrome and macOS keep theirs: the sizes that set the frame (the window bar 36/40/48, control heights, text roles, spacing, pane insets) are chosen per preset on even pixels in `ui-sizes.css`, which the build leaves as written. Everything else is written at Medium and grows by `--chrome-scale` (0.85, 1, 1.25), the same on every desktop platform. It never follows the window's size: a bigger window shows more, not bigger (as VS Code, Obsidian and Typora). `--window-scale` stays 1 for plugins that read it. Icons draw a quarter over their design size (`--icon-scale`, 1.25). The phone keeps its first design (`--chrome-scale` 10/11). A plugin's own lengths are in the first design's pixels and are taken to Medium's (×1.1, on an even pixel) as its page loads. Hairlines (1–2 px) never scale; the document's typography doesn't either - it has the document's zoom.

**Where a size is written, and how it scales:**

| Written in                                                       | Write                                                                            | Scaled by                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An app stylesheet                                                | Plain px on the grid, or a token (`--space-*`, `--control-height*`, `--shape-*`) | The build (`vite.chrome-scale.ts`): every length of 3 px and up becomes `calc(Npx * var(--chrome-scale, 1))`. Don't wrap by hand.                                            |
| The document's stylesheets (themes, the editor's content, print) | Plain px, `em`, `rem`                                                            | The document's zoom, not the chrome scale                                                                                                                                    |
| Script (a width, a gap, a threshold, a margin)                   | A named constant in interface px                                                 | `scaledPx(n)` (`src/engine/tokens/chrome-scale.ts`), or in React `useChromeScale()`. MUST NOT use a bare number. `npm run check` fails on a size constant that isn't scaled. |
| A side panel's width                                             | Its limits in interface px (`{ min, max }`)                                      | `src/engine/controls/side-panel-width.ts`: shown = chosen × scale, stored in interface px                                                                                    |
| A plugin page's stylesheet                                       | Tokens, `%`, `vw`, `clamp()`; px on the grid where nothing else fits             | Its `<style>`s and own sheets are scaled as the page loads (`src/engine/tokens/scale-lengths.ts`), the same rule as the build's                                              |
| A plugin page's script                                           | Read sizes from layout (`getBoundingClientRect`), never assume them              | -                                                                                                                                                                            |

**Layout rules that follow from it:**

- **Side panels** (sidebar, AI panel): each keeps its own width in interface px; in a small window it is drawn narrower. A panel takes at most 45% of the window; the document keeps at least 360 × scale beside both panels; a squeezed panel can go down to 200 × scale and keeps 100 × scale of room to be dragged in. The handle's range (keys, readers) is the range in force, not the panel's ideal one.
- **One header line.** The sidebar's header, every tab bar and the AI panel's header end on `--header-height` (the window bar + 36 × scale). The sidebar's fill and edge run up to the window's top (only the window's controls sit there); the AI panel's start under the window bar, whose right end - the word count, the window's buttons - is the page's. `e2e/panel-alignment.spec.ts` checks this at 820, 1280 and 1920.
- **Popups** keep `EDGE` (8) from the window's edge and `GAP` (6) from what opened them, both scaled; a menu is at most 280 × scale tall.
- **A block in the document** grows with its page up to 70% of the window's height, then scrolls inside.
- **Floating views** are their manifest's size × the user's resize × scale; folded, a 36 × scale dot.

**Reusing it.** The pieces live together and are the only way in: `src/engine/tokens/chrome-scale.ts` (`chromeScale`, `scaledPx`), `src/engine/controls/useChromeScale.ts`, `src/engine/controls/side-panel-width.ts`, `src/engine/tokens/scale-lengths.ts`, `vite.chrome-scale.ts`. A new surface uses them; it doesn't measure the window or the text size itself.

### 5.7 Islands and tabs - In force (Textus 1.3.13)

- **A window holds islands; an island holds tabs.** An island is only layout: a row of tabs over a rounded sheet (`src/engine/layout/`). Tabs are the content - documents, plugin views, web pages, the start page, Textus AI's conversations, Settings' page and a plugin's page - and any island takes any tab. An island its last tab leaves goes away.
- **Dragging moves tabs.** A tab dragged out of its row joins the island it is let go over, in its row or anywhere in its middle; within an island's outer tenth at its sides, or a twentieth at its top or bottom (stacking is the rarer wish), it makes a new island there. The zones are read from the layout as the drag began, and the one aimed at holds a little past its line, so the islands making room never move the target under the pointer; the move is made only on release. A whole island moves only with Alt (Option) held. Whatever a drag does has no menu item.
- **Numbers.** With ⌘ (Ctrl) held alone for half a second and two or more islands in the window, each island shows its number at its middle, in reading order; ⌘1–⌘6 then goes to that island's tab in front instead of making a heading. They leave when ⌘ is let go, at any other key, a press of the pointer, or the window losing the focus; nothing of them stays on screen (`src/engine/layout/island-numbers.ts`).
- **Tab widths.** A tab is as wide as its name and its fixed parts - the ×'s room always among them, shown or not, so no tab changes width as it opens or another closes - between the narrowest and the widest a tab may be. When the row can't hold them the widest give way first, a name that no longer fits fading out at its end; once even the narrowest don't fit, the row scrolls and lists every tab. One pure function decides it (`src/engine/controls/tabs/tab-widths.ts`).
- **Textus AI.** Its button opens the conversation's tab in an island of its own on the right; pressed again while that tab is in front of an island of AI tabs only, it closes them; in front of an island it shares, it does nothing; anywhere else it brings the tab to the front. Closing a conversation's tab closes the conversation (it stays in History).
- **Settings.** The rail's gear (and ⌘,) opens the sidebar on Settings' list of pages, grouped and folded, with the one settings search; picking a page replaces the page in the one Settings tab. A page has no title or description line - the list and the tab say which it is.
- **Plugins.** The rail's puzzle opens the sidebar on the plugin list (search, ⋯); a plugin opens its own page in a tab named "Plugin: name", so it never reads as a tab the plugin opens itself.
- **Sidebar panels.** Row 1 is the panel's name on the window bar's line; row 2, level with the islands' top edge, is its search - only for a panel that searches - with the panel's actions (⋯) beside it. A sidebar panel holds what is used at a glance; forms and setup go on a page in a tab.
- **One level of box.** Groups are boxes on the page; nothing inside a group is boxed again, and no group repeats the title above it.
- **Zen** shows the tab in use alone, nothing else; the split comes back when Zen ends. An × at the top right leaves it.
- **Documents always open as tabs** (no new-window choice); a tab dragged out of the window opens a window of its own.

## 6. Shape - In force

- **Containers** are rounded rectangles in three sizes: `--shape-m` 12 (islands, dialogs, sheets, cards, Settings' groups, menus, popovers, the AI composer, code blocks), `--shape-s` 8 (a box inside a card, a highlighted row, tooltips, multi-line fields), `--shape-xs` 4 (the smallest inner box). `--shape-l` is kept for plugins and draws 12. Nothing is rounder than its level; nothing is under `--shape-xs` 4.
- **Nesting** is concentric: a box inside another takes the outer radius less the padding between them (r = R − p). Boxes on one level share one radius. A large container keeps its radius and keeps its capsules at least one padding from its edge.
- **Controls** are capsules (`--shape-pill`): buttons, selects, segmented controls (track and thumb), chips, tags and switches. A button with only an icon is a circle.
- **Fields** - one-line, search and multi-line, in the app and in plugin pages - are rounded rectangles (`--shape-s`). `scripts/check-field-shapes.mjs` (in `npm run check`) fails on a field drawn as a capsule.
- **Character-level marks are square**: the caret, Vim's block cursor, the selection, find and flash highlights - radius 0–2 px.
- Where the engine supports it (Chromium 139+, so WebView2), container corners are continuous (`corner-shape: superellipse(1.25)`); capsules and circles stay `round`.
- Radii are lengths like any other: they grow with `--chrome-scale` (5.6), so the concentric rule holds at every size.

## 7. Elevation and materials - In force

| Level   | Look                                                                                      | Used for                                      |
| ------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| Flat    | No border, no shadow                                                                      | Regions of the window                         |
| Grouped | A `--ui-border` hairline, no shadow                                                       | Cards, board columns, tables, Settings groups |
| Overlay | `--ui-surface` + its one shadow (`--shadow-popover`, `--shadow-dialog`, `--shadow-sheet`) | Menus, popovers, dialogs, sheets              |

- **Three shadows**, by how far a surface stands off what is under it: `--shadow-1` resting on it (a switch's thumb, a selected segment, a margin card, a picture), `--shadow-2` floating over it (menus, popovers, a card under the pointer, the review bar), `--shadow-3` over everything (dialogs, sheets, drawers). The older names (`--shadow-popover`, `--shadow-card`…) stay, each one of the three.

- Shadows MUST appear only on overlays, each paired with its surface.
- No blur materials anywhere: every surface is solid, the frame, menus and popovers alike. Overlays only darken what is under them; they never blur it.

## 8. Icons - In force

- One set: Lucide's (ISC, `lucide-react`), one weight for every icon - a line as thick at every size (`ICON_STROKE`), round caps and joins, `currentColor` - drawn at each icon's design size and grown with the interface (`iconSize`, `--icon-scale`). `src/engine/controls/icons.tsx` names them for the app; file types (`file-icons.tsx`) and plugins' `tx-icon` names (`icon-masks.css`) use the same set and weight; a node view built outside React takes an icon's markup from `iconMarkup`.
- Only the Windows caption buttons are drawn by hand: they follow the system's 10×10 glyphs.
- A new icon takes a Lucide one, added to `icons.tsx`; a surface MUST NOT draw a one-off icon.
- Plugins name icons (`icon: "calendar"` in a list item; `<span class="tx-icon" data-icon="filter">` in a page, names in 15.4) instead of drawing their own.
- Emoji are content, not icons; the interface MUST NOT use emoji as icons.

## 9. States and focus - In force

- One rule for every control: hover `--ui-hover`; pressed one step stronger; selected `--ui-selected`; disabled 50% opacity.
- In a list typed into (the `/` panel, the command palette, the chat's `/` and `@`), the option the keys are on is selected (`--ui-selected`); a menu's row under the pointer or keys is hovered (`--ui-hover`).
- The focus ring shows only for keyboard focus (`:focus-visible`): the accent, 2 px (3 px with more contrast), drawn inside the control (`outline-offset: -1px`, `-2px` in a scrolling list).
- A highlight in a list or menu arrives in 80 ms and leaves at once, so a pointer running down a list leaves no trail.

## 10. Motion - In force

- Durations, curves, offsets and scales come only from `src/engine/motion/motion.css`. `src/engine/motion/motion-tokens.test.ts` fails on a new keyframe or a raw time elsewhere.
- Everything that moves is one of these moves: **enter** (`motion-enter`, `enter()`), **exit** (`motion-exit`, `exit()`), **mark** (`.motion-mark`, `land()`), **glide** (FLIP, `engine/motion/flip.ts`), **beat** (`startBeat` / `enterOnBeat` / `joinBeat`: the parts of one change appear as one), **crossfade** (`crossfade()`), with **presence** (`engine/motion/usePresence.ts`) keeping an element mounted while it exits.
- Durations: `--dur-instant` 80 ms (press, hover colour), `--dur-fast` 120 ms (small exits, fades), `--dur-base` 200 ms (menus, popovers, dialogs), `--dur-medium` 250 ms (_Planned, 1.3.13_: folded into 200 or 320), `--dur-slow` 320 ms (sidebar, AI panel, Settings, Zen mode), `--dur-sheet` 450 ms (phone sheets). An exit takes about 70% of its entry. Loops (`--dur-blink`, `--dur-pulse`, `--dur-spin`, `--dur-sheen`, `--dur-drift`) are only for "working" indicators.
- Curves: `--ease-standard` (in place), `--ease-out` (entry), `--ease-in` (exit), `--ease-in-out` (movement), `--ease-spring-bouncy` (about 3% overshoot) only for a finger release.
- Only `opacity` and `transform` animate (`src/engine/motion/motion-properties.test.ts`). Size changes use FLIP or a crossfade.
- Toggles (sidebar, panels, switches, arrows) use transitions so they can reverse; keyframes are only for one-time entries. An exiting element is `inert`; animations never block input.
- Space is consistent: a surface grows from its anchor and shrinks back into it, enters and leaves the same way, one direction per surface.
- **Dragging** looks the same everywhere: the copy under the pointer is lifted - `scale: 1.06`, `--ui-surface`, `--shadow-popover` (`.tx-drag-ghost`, `.tree-drag-ghost`, `.tab-pull-ghost`, `.tab-pill-lifted`, `.is-drag-lifted`) - and the place it left, where it stays, is a dashed outline (`.tx-drag-source`). The copy stays exactly under the point it was taken by, zoomed or not.
- Nothing moves while the user types: input, the caret, the selection, completions, typewriter scrolling, find highlights and counts change instantly.
- Under reduced motion, offsets and scales become 0, springs become the standard curve, slow motion becomes a 150 ms fade, loops stop and smooth scrolling is instant (`engine/motion/motion.ts`: `prefersReducedMotion()`, `motionAllowed()`).

## 11. Components - In force

| Component                | Rule                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buttons                  | Solid **primary** (ink, one per group), **secondary** (light border), **text** button for the next level down. One action appears as one button in one place. Size, radius and states are defined once in `design-system.css`; a component sets only layout and text colour                                              |
| Icon button              | A 24 circle, no border in headers, toolbars and inline; named with `aria-label`, hinted with `engine/controls/Tooltip.tsx`, never `title`. _Planned (Textus 1.3.13)_: a tooltip is a callout beside what it names, with a small arrow pointing at it, its shortcut after the name                                        |
| Fields                   | Every text field is a `--shape-s` rounded rectangle (6). The focus ring is inside                                                                                                                                                                                                                                        |
| Select                   | `engine/controls/Select.tsx` with the drawn arrow, in the two control heights. Native dropdowns MUST NOT be used                                                                                                                                                                                                         |
| Checkbox                 | `.ui-check`: 15 px, `--shape-xs`, accent fill when checked                                                                                                                                                                                                                                                               |
| Switch                   | 1.5 times its row's text tall (em-based) on every platform and text size                                                                                                                                                                                                                                                 |
| Segmented control / tabs | Capsule track and thumb; the chosen one a raised `--ui-surface` thumb                                                                                                                                                                                                                                                    |
| Tags, chips, badges      | Capsules at 20–24; tags take a tone (3.4); a chip shows a rule in force and opens it                                                                                                                                                                                                                                     |
| Menus                    | Every menu is `ContextMenu` - at the pointer, or hung from a button with `useMenuButton` - with one panel padding (4), one item size (4×8 padding, `body`), one hover, separators (1 px, 4×8 margin). A menu that stays open while its checks are changed, or holds a note, keeps its own rows on the same surface (5.5) |
| Dialogs                  | `engine/controls/app-dialog.tsx` (`showMessage`, `showConfirm`); native alert and confirm MUST NOT be used                                                                                                                                                                                                               |
| Popups                   | See 5.5: one surface (`.floating-surface`), one way to close (`useCloseOnOutsideClick`, active only while open), one way to place (`engine/controls/placement.ts`)                                                                                                                                                       |
| Tables                   | The document's own table look: a rounded frame (`--doc-radius`), a header tinted `--doc-code-bg`, `--doc-border` hairlines                                                                                                                                                                                               |
| Cards                    | Grouped level (section 7): hairline, no shadow, `--shape-m`                                                                                                                                                                                                                                                              |

Only the open and save file dialogs and the macOS system menu bar stay native.

## 12. Words in the interface - In force

- Group headings in Title Case ("Fixed Shortcuts"); row labels in sentence case ("Save automatically"); a menu item's own name as it is ("Source Mode").
- A switch is named by what it turns on, without "Enable" (except one that turns on a whole AI feature).
- A row's label says what the setting does on its own ("Show page numbers in exports", not "PDF page numbers" with a line under it).
- A "?" after a label (`engine/controls/InfoTip.tsx`) is for a label that can't be understood without it and whose explanation matters (a trade-off between choices, outside setup). It shows on hover, click or tap, never as grey text under the row.
- What is live stays visible under the row: a value or a status.
- In Settings, a page's groups go from the most used to the least, links out last. A row that only means something with another setting on is hidden while it is off and comes right after it.
- Every string is localized (`src/i18n/`); interface text never hard-codes a language.

## 13. Accessibility - In force

- Every control has a name in the interface language; an icon-only button has `aria-label`.
- Landmarks: the window bar is `header`, the document column `main`, the sidebar and AI panel labelled `aside`s; the editor is a `textbox` named Document.
- Status that appears without focus moving goes through `announce()` (`src/engine/controls/announce.ts`), one polite live region; no other live regions.
- Every action works from the keyboard. `F6` / `Shift+F6` move between regions (`src/app/regions.ts`); a list of like items is one tab stop walked with the arrow keys (trees, tab lists, menus).
- Esc closes the topmost surface only and returns focus to what opened it.
- Information never rests on colour alone.
- `e2e/a11y.spec.ts` runs axe-core over the main screens in light and dark and fails on serious or critical violations.

## 14. Themes - In force (14.3–14.5: Planned)

### 14.1 What a theme may change

- MAY: every `--doc-*` variable (colours, fonts, the document's typography, its default `--doc-font-size` and `--doc-line-height`), the interface inputs through them (3.1), any `--ui-*` colour, the tones (3.4), and `--revision-*` (how a proposed AI change is drawn).
- MUST NOT: the app's sizes, spacing, radii, elevation or motion tokens, or the editor's structure (the caret, the selection, revision marks, plugin block frames). The document's own blocks may have their margins, padding and corners.
- A theme with only one colour scheme keeps it; it is not forced into dark.
- Remote `@import`, image backgrounds and layouts that depend on Typora's DOM are outside the compatibility promise.
- A theme from an AI reply is held to this list when it is installed: `src/theme/theme-allowlist.ts` parses it with the webview's CSS parser and keeps only rules for `:root`, `html`, `body` and the document (`#write`, `.milkdown`), the variables above, and the document's colour, typography, border and spacing properties; everything else is dropped. A theme that would load anything but a `data:` URI is not offered.

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

## 15. Plugins - In force

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

### 15.3 What a plugin page is given - In force (Textus 1.3.2)

Every plugin page (a sidebar tab, a tab view, a code block, a settings page) gets, before its own HTML and with no setup:

1. **The tokens**: every role token on the list in `src/plugins/views/theme-vars.ts` - colours (tones included), type roles, spacing, shapes, control heights, durations and curves, the popover shadow - kept current when the theme or appearance changes.
2. **The app's own stylesheets**: `src/engine/motion/motion.css`, `src/engine/tokens/design-system.css` and `src/engine/controls/components.css`, the same files the window loads. A `tx-` class in a page is the app's control from the same rule, not a copy.
3. **Base element styles** (`src/plugins/host/runtime/plugin-ui.css`): bare `button`, `input`, `select`, `textarea`, headings, links, `.toolbar`, `.list`, `.empty` already look like Textus.
4. **Attributes on `<html>`**: `data-theme` (`light` | `dark`), `data-platform`, and `data-window-chrome="mobile"` on a phone, so controls take the phone's sizes there.
5. **The page API** from `acquireTextusApi()` (or `textus`): `t()`, `postMessage`, `onMessage`, `getState` / `setState`, `onExport`, and `menu()` (15.5).

A plugin MUST NOT ship its own copy of any of these, and MUST NOT restyle a `tx-` class.

### 15.4 The components, and how to write them - In force (Textus 1.3.12)

The list of controls a plugin page may use, with their markup, is
[docs/dev/plugins/ui.md](../dev/plugins/ui.md) › Controls - one list, for
the app and plugins alike; the styles are `src/engine/controls/components.css`,
`src/engine/controls/icon-masks.css`, `src/engine/controls/controls.css`,
`src/engine/controls/progress.css` and `src/engine/controls/bubble.css`. Class names are public API (2.1): write them exactly
as there; combine only the modifiers listed. Icons (`<span class="tx-icon"
data-icon="…">`): `text`, `number`, `select`, `multi`, `date`, `checkbox`,
`url`, `page`, `filter`, `sort`, `plus`, `more`, `table`, `board`,
`calendar`, `gallery`, `open`, `chevron`, `left`, `right`, `search`,
`close`, `check`, `eye-off`, `trash`, `rename`, `sliders`, `refresh`,
`minus`, `rotate`.

Layout around the controls uses the spacing and layout tokens (5.6), never
fixed pixels. Nothing in a page draws a shadow except a lifted, dragged
item and Textus's popups.

### 15.5 Menus - In force (Textus 1.3.2)

A right-click menu or a dropdown in a page MUST be Textus's own:

```js
const api = acquireTextusApi();
button.addEventListener("click", async (event) => {
  const choice = await api.menu(
    [
      { label: api.t("sortAscending"), value: "asc" },
      {
        label: api.t("sortDescending"),
        value: "desc",
        checked: sort === "desc",
      },
      "separator",
      { label: api.t("type"), items: [{ label: "Text", value: "text" }] },
      { label: api.t("delete"), value: "delete", danger: true },
    ],
    event.currentTarget, // or { x: event.clientX, y: event.clientY } for a right-click
  );
  if (choice === null) return; // closed without a choice
});
```

Items: `{ label, value, checked, danger, disabled }`, `"separator"`, or `{ label, items }` for one level of submenu. The promise resolves to the chosen item's `value` (its `label` when it has none) or `null`. On a phone the same call shows an action sheet. Free text a menu can't hold - a name, a search - goes in a field in the page, or in `textus.ui.input` from the plugin's host code.

Planned: `api.select()` for a field's dropdown and `data-tooltip` for the app's tooltips. Until then use `menu()` with `checked` for a choice, and give an icon button a `title` as well as its `aria-label` (the one hint a page can show); `title` goes when `data-tooltip` comes.

### 15.6 Colours in a plugin page

- Use tokens by their job (3.2). The page's background is `--ui-bg` (a panel) or `--doc-bg` (a tab view, a block in the document).
- Categorical colour is a tone: assign tones in their order, by position (an option's place among its property's options), so the same list gets the same colours every time.
- A chart, graph or canvas library gets the tones as its palette and `--ui-text`, `--ui-muted` and `--ui-border` for its labels, axes and grid. Read them with `getComputedStyle(document.documentElement).getPropertyValue("--tone-blue")`, and again when the page gets the `theme` update (the `<html data-theme>` attribute changes).
- A theme with a signature palette sets the tones (14.3), so a plugin that follows these rules takes the theme's colours without knowing it.

### 15.7 A plugin page, start to finish

```html
<div class="tx-bar">
  <div class="tx-segmented" role="tablist">
    <button class="tx-segment" role="tab" aria-selected="true">Table</button>
    <button class="tx-segment" role="tab" aria-selected="false">Board</button>
  </div>
  <span class="tx-spacer"></span>
  <button class="tx-icon-button" id="filter" aria-label="Filter">
    <span class="tx-icon" data-icon="filter"></span>
  </button>
  <button class="tx-button small primary">New</button>
</div>
<div class="tx-table-frame">
  <table class="tx-table">
    <thead>
      <tr>
        <th><span class="tx-icon" data-icon="text"></span>Name</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Draft the outline</td>
        <td><span class="tx-tag status" data-tone="blue">Doing</span></td>
      </tr>
    </tbody>
  </table>
</div>
```

No `<style>` is needed for any of it. A page's own CSS is for layout only (grid, flex, widths), with token values.

### 15.8 Where a plugin puts things - In force (Textus 1.3.13)

One rule for every plugin:

1. **Content** - a board, a database, a reader - opens in a tab (`layout.openView`).
2. **Settings and setup** - a server address, keys, options - go on the plugin's own page, which Textus draws from its declared settings and opens in a tab (`layout.openSettings()`).
3. **Quick or frequent things** - a status, a list to pick from, "sync now" - go in a sidebar panel: simple, at a glance, no forms.
4. **An AI plugin** (an outside agent, `contributes.agents`) gets a button at the window bar's end, beside Textus AI's, drawn from the plugin's icon: a press opens the AI with that agent; pressed again while it is in use, it acts as the AI button does. The plugin draws nothing there itself.

## 16. Front-end architecture

Moved to [architecture.md › UI layering](../dev/architecture.md#ui-layering),
with the folder layers.

## 17. Review checklist

Before a change to the interface, a plugin page or a theme is merged:

- [ ] Every colour, size, radius, space, duration and font is a token (2, 3, 4, 5, 6, 10).
- [ ] Colours are taken by their job (3.2); categorical colours are tones (3.4); the primary button is ink.
- [ ] Type uses roles; the interface and document fonts are not mixed (4).
- [ ] The surface uses a template (5.4) and its row in the surfaces table (5.5); controls use the two heights (5.3).
- [ ] Containers are concentric; controls are capsules; character marks are square (6).
- [ ] Only overlays have shadows (7).
- [ ] Icons come from the set (8).
- [ ] Hover, selected, disabled and focus follow section 9; the page works from the keyboard (13).
- [ ] Motion uses the moves and tokens; nothing moves while typing (10).
- [ ] Words follow section 12 and are localized.
- [ ] Light and dark, the four built-in themes, and one imported theme were looked at; a plugin page also in one signature-palette theme.
