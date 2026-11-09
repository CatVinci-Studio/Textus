# A plugin's interface

How a plugin shows things so it looks and behaves like the rest of Textus:
which layer to use, the five kinds of surface, every control a page may
use, and the rules for sizes and colours. The design standard behind it is
[design-language.md](../../design/design-language.md) §5.6 and §15; how
pages work (webviews, messages, menus, dragging) is [pages.md](pages.md).

## Four layers, most preferred first

| Layer                        | The plugin                                                                                                                                                      | Textus                                                   | Use it for                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Declared                  | writes settings, commands, menus, key bindings and status items in its manifest                                                                                 | draws them all                                           | anything that is a setting, an action or a word in the status bar         |
| 2. Drawn by Textus           | calls an API with the data: `views.registerList`, `ui.pick`, `ui.input`, `ui.form`, `ui.pickDate`, `ui.pickColor`, `ui.notice`, `ui.withProgress`, `ui.confirm` | draws it as its own                                      | lists in the sidebar, choices, questions, dates, colours, progress, notes |
| 3. A page of shared controls | writes a page using only the controls below                                                                                                                     | gives the controls' look, size, colours, keys and motion | a board, a table, a calendar, a viewer's toolbar                          |
| 4. Free drawing              | draws content itself: a chart, a canvas, a picture, a PDF page                                                                                                  | gives the colour tokens and the scale                    | the content only - never its bars, buttons or lists                       |

A plugin MUST use the first layer that can do the job. In layers 3 and 4,
everything around the content - bars, buttons, lists, empty states - is
made of the shared controls.

## Five surfaces

Each kind of surface has one shape. A plugin's surface is one of these.

| Surface               | Opened with                                           | Shape                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar panel         | `views.registerList` (preferred) or a sidebar webview | a title row (its name, at most two circle icon buttons) → an optional search field → a `tx-list` → a `tx-empty`                                                                                                                                                                                                                              |
| Editor or tab view    | `views.registerFileEditor`, `layout.openView`         | a `tx-bar` `var(--bar-height)` high (start: navigation and view switching; end: actions, the primary button last) → the content                                                                                                                                                                                                              |
| Block in the document | `views.registerCodeBlock`                             | a figure (chart, diagram): the content alone, one line for an error. A record (a database, tasks): one `tx-bar`, then the content, at most 70% of the window high, scrolling inside. Its bar leaves `var(--block-source-room)` at its end for the block's source button. It draws no fold arrow and no title of its own: Textus folds blocks |
| Floating view         | `contributes.floatingViews`                           | the content alone, its manifest's size, scaled with the interface; folded, a dot                                                                                                                                                                                                                                                             |
| Settings              | declared `settings` (preferred) or a settings page    | `tx-group-title`, `tx-group`, `tx-row`: Settings' own look                                                                                                                                                                                                                                                                                   |

## Controls

Class names are public API: write them as below, and don't restyle them.
Every control takes its sizes from tokens, so it grows with the interface,
and its colours from the theme, so it follows light, dark and every theme.

### Buttons and fields

| Control        | Markup                                                                                                                      | Notes                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Button         | `<button class="tx-button">Cancel</button>`                                                                                 | `small` in bars and cards                                  |
| Primary button | `<button class="tx-button primary">Save</button>`                                                                           | at most one per group, last                                |
| Icon button    | `<button class="tx-icon-button" aria-label="Filter"><span class="tx-icon" data-icon="filter"></span></button>`              | a circle; `aria-label` required                            |
| Icon           | `<span class="tx-icon" data-icon="calendar"></span>`                                                                        | names in design-language.md §15.4                          |
| Field          | `<input class="tx-input">`                                                                                                  | a capsule; `<textarea class="tx-input">` a box             |
| Field in place | `<input class="tx-inline-input">`                                                                                           | no frame: the cell or card it sits in is the field         |
| Square corners | add `tx-square` to a button, field or select                                                                                | capsules by default; square where a grid or table wants it |
| Checkbox       | `<input type="checkbox" class="ui-check">`                                                                                  | ticking things off                                         |
| Switch         | `<input type="checkbox" role="switch" class="tx-switch">`                                                                   | turning a setting on and off                               |
| Select         | `<button class="tx-select">Week<span class="tx-icon" data-icon="chevron"></span></button>`                                  | opens Textus's menu: `api.menu(items, button)`             |
| Slider         | `<input type="range" class="tx-slider">`                                                                                    | `var(--slider-width)` wide                                 |
| Segmented      | `<div class="tx-segmented" role="tablist"><button class="tx-segment" role="tab" aria-selected="true">Table</button>…</div>` | 2–5 views or modes                                         |
| Chip           | `<button class="tx-chip">Status is Done</button>`                                                                           | a rule in force; opens it                                  |
| Tag            | `<span class="tx-tag" data-tone="green">Done</span>`                                                                        | `status` adds a dot; tones in their order                  |

### Bars and navigation

| Control | Markup                                                                                                                                                                                                      | Notes                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Bar     | `<div class="tx-bar">…<span class="tx-spacer"></span>…</div>`                                                                                                                                               | navigation first, actions last                                         |
| Zoom    | `<div class="tx-zoom"><button class="tx-icon-button" aria-label="Zoom out">…minus…</button><button class="tx-value">100%</button><button class="tx-icon-button" aria-label="Zoom in">…plus…</button></div>` | the value resets the zoom when clicked                                 |
| Pager   | `<div class="tx-pager"><button class="tx-icon-button" aria-label="Previous">…left…</button><span class="tx-value">3 / 12</span><button class="tx-icon-button" aria-label="Next">…right…</button></div>`     | pages, slides, months                                                  |
| Find    | `<div class="tx-find"><input class="tx-input" type="search"><span class="tx-value">2 / 9</span>…arrows…</div>`                                                                                              | matches in the page take `tx-hit`, the current one `tx-hit is-current` |

### Lists, groups and folding

| Control        | Markup                                                                                                                                                                                              | Notes                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| List           | `<div class="tx-list" role="listbox"><button class="tx-list-row" role="option" aria-selected="true"><span class="tx-list-label">Draft</span><span class="tx-list-meta">2 min</span></button></div>` | one tab stop, arrows move (design-language.md §9) |
| List heading   | `<div class="tx-list-heading">Today</div>`                                                                                                                                                          | between rows: a day, a group                      |
| Folding        | `<details class="tx-disclosure"><summary>Advanced</summary>…</details>`, or a button with `aria-expanded` holding `<span class="tx-disclosure-caret"></span>`                                       | the app's own caret                               |
| Settings group | `<div class="tx-group-title">General</div><div class="tx-group"><div class="tx-row"><span>Label</span>…</div></div>`                                                                                | Settings' look                                    |
| Card           | `<div class="tx-card">…</div>`                                                                                                                                                                      | a hairline, no shadow                             |
| Table          | `<div class="tx-table-frame"><table class="tx-table">…</table></div>`                                                                                                                               | the document's table look                         |
| Empty state    | `<div class="tx-empty">No tasks yet.<button class="tx-button">New task</button></div>`                                                                                                              | one sentence, at most one button                  |

### Records and progress

| Control  | Markup                                                                                                                                                           | Notes                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Calendar | `<div class="tx-calendar"><span class="tx-calendar-weekday">M</span>…<button class="tx-calendar-day is-today is-marked" aria-selected="false">8</button>…</div>` | `is-other` for days outside the month |
| Board    | `<div class="tx-board"><div class="tx-lane"><div class="tx-lane-head">…</div>…cards…</div></div>`                                                                | lanes `var(--board-lane-width)` wide  |
| Rating   | `<span class="tx-rating">★★★☆☆</span>`, or `★ <span class="tx-value">7.5</span>` past five                                                                       | one look down a whole column          |
| Progress | `<div class="tx-progress" role="progressbar" style="--value: 0.4"></div>`; `is-indeterminate`; `ring` for a circle `var(--progress-ring-size)` across            |                                       |
| Bubble   | `<div class="tx-bubble">…</div>`                                                                                                                                 | a floating view's line, beside it     |

### Dragging

Use `lib/drag.js` (pages.md › Dragging). Two kinds, as in the rest of
Textus: `drag.reorder` for a row of tabs or columns - the item itself
follows the pointer along its row and the others slide aside, nothing
floats - and `drag.sortable` for things moved between lists (cards between
a board's lists): a lifted copy follows the pointer. Either way it stays
under the point it was taken by, in a zoomed document too.

## Sizes and colours

- **No fixed screen pixels.** Write spaces with `--space-*`, heights with
  `--control-height*` and `--bar-height`, corners with `--shape-*`, widths
  with `%`, `vw`, `clamp()` or the layout tokens (`--board-lane-width`,
  `--find-field-width`, `--slider-width`, `--progress-ring-size`,
  `--bubble-width`, `--block-source-room`). Textus scales a page's own
  stylesheets as they load (design-language.md §5.6), but that is a safety
  net, not a way to write sizes.
- **In script, read sizes from layout** (`getBoundingClientRect`), never
  assume them; in a zoomed document a pointer moves in screen pixels, the
  page in its own: divide by `rect.width / el.offsetWidth`.
- **Colours from the theme only**: the role colours (`--ui-*`), the
  document's (`--doc-*`), the tones (`--tone-*`). A sheet of paper is
  `--paper-bg`, a full-screen stage `--stage-bg`. No literal colour, no
  brand colour.
- **Text by role** (`--text-body`, `--text-secondary`, `--text-footnote`,
  `--text-caption`), never a px font size.

The plugins repository's check reports fixed pixels, literal colours and
hand-drawn copies of these controls.
