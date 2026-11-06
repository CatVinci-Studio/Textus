### Improved

- Themes, Custom CSS and a document's HTML can no longer load anything from the web except pictures: web fonts, remote stylesheets (`@import`), scripts and network requests are blocked by a Content Security Policy. An imported Typora theme that loaded its fonts from a web font service shows your system fonts instead.
