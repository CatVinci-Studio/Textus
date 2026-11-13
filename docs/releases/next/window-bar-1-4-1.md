### New

- Appearance › Show the title bar on its own row puts the document's name in a row of its own across the top, with the tabs in the row under it, as VS Code does; with the menu bar shown, the name sits in the middle of the menu's row. A window with one document then shows it as one rounded sheet just under its name, the tabs coming back with a second. Off by default.

### Improved

- Interface Size comes in three presets, Small, Medium and Large, each laid out on whole, even pixels as Chrome and macOS set theirs: the window bar is 36, 40 or 48 points tall, with room above its tabs, and the interface's text, controls and spacing step with it. Medium is the size the interface had before; a size chosen before moves to the nearest preset, and widths you dragged the sidebar and panels to are kept.
- A sidebar panel's search box has room round it, its sides level with the panel's name.
- The sidebar's Plugins list shows each plugin's name and what it is for on one line, with a small Install or Update button at the end; who made it is on its page.
- However many tabs are open, the window bar keeps some bare room before its buttons to move the window by.
- Documents lift off the window the same way in light and dark: a faint rim and a soft two-layer shadow, the dark window a step deeper, instead of a grey outline.

### Fixed

- The sidebar's top row, where it reaches the top of the window, moves the window like the rest of the bar.
- The open tab's outline joins its sheet's edge again: the sheet's top edge no longer goes missing under the window bar, which on some screens left the tab's curves hanging apart.
- Jumping back to the top of a document, or switching back to it, no longer leaves its first lines under the format bar.

### Platform notes

- **Windows and Linux:** the window bar is as tall as on macOS, at every interface size.
- **macOS:** the traffic lights sit on the window bar's middle line at every interface size.
- **macOS:** closing a web page tab lets the page finish drawing first, which avoids a rare crash.
