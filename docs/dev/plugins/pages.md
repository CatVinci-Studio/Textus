# Plugin pages

A plugin draws what Textus can't draw for it - a board, a chart, a
calendar - in a page of its own: a webview. This is how pages work, what
they get from Textus, and the few rules that keep them looking like
Textus. The design standard behind them is
[design-language.md](../../design/design-language.md) §15.

## Webviews

A webview is a sandboxed frame of HTML the plugin sets:

```js
textus.views.registerWebview("jane.board.view", {
  async resolve(webview) {
    webview.onDidReceiveMessage((message) => {
      if (message.type === "hello") webview.postMessage({ type: "hi" });
    });
    webview.html = await ctx.plugin.readText("board.html");
  },
});
```

```html
<link rel="stylesheet" href="textus-resource:board.css" />
<button id="hello">Hello</button>
<script>
  const api = acquireTextusApi();
  api.onMessage((m) => console.log(m.type));
  document.getElementById("hello").onclick = () =>
    api.postMessage({ type: "hello" });
</script>
```

- `textus-resource:<path>` names one of the plugin's files
  (`webview.asWebviewUri(path)` writes the same).
- A webview has no network and no storage of the browser's: it asks its
  plugin, with `postMessage`. `api.getState()` / `api.setState(value)`
  keep a little state while Textus runs.
- The theme's colours and sizes are CSS variables that follow the theme
  and dark mode, the same ones Textus draws with
  ([design-language.md](../../design/design-language.md)): the interface's
  colours `--ui-bg`, `--ui-surface`, `--ui-subtle`, `--ui-text`,
  `--ui-muted`, `--ui-accent`, `--ui-border`, `--ui-hover`,
  `--ui-selected`, `--ui-danger`; the document's `--doc-bg`, `--doc-text`,
  `--doc-accent`, `--doc-code-bg`; text by role, `--text-caption` to
  `--text-title`; shapes, `--shape-m` for a panel or card, `--shape-s`
  for a box or row inside one, `--shape-pill` for a button or chip;
  `--control-height(-sm)`, `--space-1` to `--space-6` and `--font-sans` /
  `--font-mono`. Buttons, inputs, `.toolbar`, `.list` and `.empty` look as
  Textus's own without any CSS of yours.
- Motion is Textus's too: `animation: motion-enter var(--dur-medium)
var(--ease-out) backwards` for a part arriving, `motion-exit` for one
  leaving, a `motion-cascade` container for items one after another.
  With the system's Reduce motion they become fades. Animate only
  `opacity` and `transform`.
- A code block's frame grows with its page; others fill their place.

### Code blocks in an export

A page can't go into a PDF, a Word file or an HTML page, so an export asks
each code block's page for a picture of itself with `api.onExport`: an
SVG's markup or an image's `data:` URL, drawn for the exported page's
`theme` ("light" for paper). The picture takes the drawing's place; a page
that gives none exports as the block's source.

```html
<div id="chart"></div>
<script src="textus-resource:lib/chart.min.js"></script>
<script>
  const api = acquireTextusApi();
  const chart = drawChart(document.getElementById("chart"));
  api.onExport(({ theme }) => chart.toSvg({ dark: theme === "dark" }));
</script>
```

Textus asks once the page has loaded (its scripts included), and waits a
few seconds for an answer.

## Textus's controls

A page shares Textus's stylesheets: buttons, inputs, `.toolbar`, `.list`
and `.empty` look like Textus's own with no CSS of yours, and the `tx-`
classes give the rest - `tx-bar` (a row of controls), `tx-button`
(`small`, `primary`), `tx-icon-button`, `tx-segmented` / `tx-segment`,
`tx-chip`, `tx-tag` (with `data-tone`), `tx-card`, `tx-table` in a
`tx-table-frame`, `tx-empty`, and `tx-icon` with `data-icon` for Textus's
icons. Lay them out with your own CSS, using only the variables above.

Menus are Textus's: `api.menu(items, element)` opens one under an element
(items `{ label, value, checked?, danger?, items? }`, `"separator"`) and
resolves with the value chosen, or null.

## Dragging

HTML drag and drop doesn't work in a page: the Textus window takes it for
dropping files, so the cursor shows a copy sign and nothing lands. Drag
with pointer events instead - `pointerdown`, then `pointermove` and
`pointerup` on `window` - and swallow the click the release sends.
Textus's own official plugins share one small helper for this
(`shared/drag.js` in textus-plugins: `drag.sortable` moves an item through
lists while the others make way). Its styles are Textus's:
`tx-drag-ghost` for the copy under the pointer and `tx-drag-source` for
the place it will land.

## Floating views

A floating view is a small page over the window or, on the desktop, over
the whole screen - Desk Pet and Pomodoro are two. Declare it in
`contributes.floatingViews` (`{ id, title, width, height, place:
"window" | "desktop" | "either" }`), register its webview like any other,
and open it with `textus.layout.openFloating(id)`. The user drags,
folds and closes it; `layout.onDidChangeFloating` says when, and
`layout.onDidTouchFloating` when it was poked, petted or carried. Stop
animating while it isn't visible.
