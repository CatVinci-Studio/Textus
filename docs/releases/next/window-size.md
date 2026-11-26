### Fixed

- Textus opens at the size and place you left it, also when the window filled the screen or was maximized or in full screen: it opens that way again. With **Settings › General › On launch, open › Last documents**, each window comes back where it was. A window left on a screen that is no longer connected opens on the main screen, no bigger than it. (#795)
- The first time Textus opens, its window is 1200 × 800, or the size of a smaller screen, centred, instead of 800 × 600. (#795)

### Platform notes

- On Linux with Wayland, windows open at their last size; Wayland doesn't let an app choose where its window goes.
