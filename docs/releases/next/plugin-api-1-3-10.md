### Platform notes

- Plugins: `layout.showSidebarTab(id)` opens the sidebar on a tab, and a list's provider can take `onMove(item, target)` for rows dragged onto one another (docs/dev/plugin-reference.md).
- Plugins: `layout.panels()` and `layout.onDidChangePanels` tell which of the window's panels are open - the sidebar (and its tab) and Textus AI's - read only.
- Plugin pages can drag with pointer events and Textus's `tx-drag-ghost` / `tx-drag-source` styles; HTML drag and drop inside a page is taken by the window's file drop.
