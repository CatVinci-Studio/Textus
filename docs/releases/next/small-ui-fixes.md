### Fixed

- The window bar says "1 word" instead of "1 words".
- A plugin list's filter box in the sidebar, such as Tasks', is one line high instead of stretching down the sidebar.
- A click at the end of a line that ends in a [[wikilink]] puts the caret after the link: what you type next, and Enter, no longer go into it.
- The sidebar's top row, each pane's tab bar and the AI panel's header end on one line, and a row of tabs too long to fit no longer grows a scrollbar under it.
- A tab's right-click menu no longer leaves a gap before Read Only while it is off.
- A web page that doesn't load says so in its tab, with Reload and Open in Browser, instead of staying blank.
- A web page out of sight for five minutes is let go, and no more than three stay loaded: each takes a WebKit process of its own. Shown again, it loads its last address.
- Web pages on a Mac name themselves as Safari does, so sites such as Bilibili no longer turn them away as an old browser.
- A plugin's pages load its files by URL instead of inlining them: a window drawing a PlantUML block took close to 3 GB, and now takes under 200 MB. Charts, PDFs and Word documents open with far less memory too.
