### New

- Drag a picture or any other file into a document to put it in where you let go: a picture shows as an image, a PDF, spreadsheet, video or other file goes in as a link. Room opens between the blocks as you drag, the size of what will go in, with a note of what letting go does. From a file manager, the file is first copied where the document's pictures go (**Settings › Images**); from the sidebar, it is linked where it is. Notes still open in a tab, and holding `Shift` opens any file instead. Let go close by a document's left or right side it opens beside it (a narrower band than a tab's, and never above or below), and on a tab row in a new tab - now from a file manager too. (#777)
- Drag files or folders from a file manager onto a folder in the file tree to copy them in, as in VS Code: the folder under the pointer lights up (a file's row means its folder, the blank below the rows the open folder), and Textus asks first, with a **Don't ask again** box; **Settings › General › Ask before copying files dropped onto the file tree** turns the question back on. Files are copied, never moved, and never over anything there: a taken name becomes `report 2.pdf` or `photos 2`. Without a folder open, a file let go on the sidebar opens as before.
- Plugins can write a dropped file as Markdown of their own with `editor.registerDropHandler` (plugin API 1.10).

### Improved

- Several files dragged together from the sidebar now go into the document or open together.
