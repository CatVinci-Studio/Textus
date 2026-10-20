# Supported web engines

Textus draws its interface with the system's web engine, so the oldest
engine a user may have is the oldest one the frontend has to work in.

| Platform                           | Engine              | Oldest supported                             |
| ---------------------------------- | ------------------- | -------------------------------------------- |
| Windows 10 and 11                  | WebView2 (Chromium) | Chromium 105                                 |
| macOS 11 and later                 | WKWebView           | the installed Safari's; the build assumes 16 |
| iPhone and iPad (iOS 16 and later) | WKWebView           | Safari 16                                    |
| Linux                              | WebKitGTK           | what the distribution ships                  |

## Why Chromium 105 on Windows

WebView2 is the Evergreen runtime: it updates itself, apart from Windows
Update, and an up-to-date machine runs the same Chromium as Edge. Our
installer only installs the runtime when there is none
([windows-installer.md](windows-installer.md)). So an old WebView2 means a
machine where the runtime is there but doesn't update: a school or office
image that is reset on every boot, a policy that blocks Edge updates, a
machine kept offline. #260 came from a Windows 10 22H2 computer lab whose
WebView2 is older than Chromium 108 (it drops `dvh`) and than 111 (it drops
`color-mix()`).

105 is the line because:

- It is what Tauri 2 tells a Vite frontend to build for on Windows
  (`target: "chrome105"` in its templates).
- Windows 10 22H2, the last Windows 10 release, came out in October 2022,
  when WebView2 was at Chromium 106. An image made then that never
  updates is about there.
- Below it, `:has()` and container queries (`container-type`, `cqi`) are
  missing. Both are used across the app, and neither has a fallback that
  keeps its layout; a fallback for everything older would mean a second
  stylesheet.

`vite.config.ts` builds for `chrome105` and `safari16`. That lowers newer
JavaScript syntax; it doesn't add newer APIs or make newer CSS work.

## What an old engine got wrong, and what we do about it

Checked with a Chromium 107 build (see [Testing](#testing)) against a
current one, before and after:

- **color-mix() (Chromium 111).** Almost every use names a `var()`, so the
  old engine keeps the declaration and drops the value only once the
  variable is filled in - and the property then computes to `unset`, not
  to a line written before it. Off switches had no track, cards and
  Settings groups no background or hairlines, the review bar no fill, and
  proposed edits no green or red. The build now gives each such rule a
  twin in `@supports not (color: color-mix(...))` with plain colours
  (`vite.color-mix-fallback.ts`): a tint of a theme colour in that
  colour's hue at the same opacity, grey for a tint of the text, or the
  heavier of the two colours.
- **Early container queries (Chromium 107; current versions don't).** An
  element with `container-type` was the containing block of its
  `position: fixed` descendants, and CSS animations inside a size
  container restarted every few frames. The document column is a
  container, so the editor's context menu, find bar, Insert Table and
  image dialogs were placed against the column, not the window; the AI
  panel's empty state is one, and its text and icon pulsed.
  `ui/engine-quirks.ts` measures this at startup and marks `<html>`;
  neither is a container there. The document's type then stays at the
  standard 16.5px instead of growing with a wide column, and the empty
  state keeps its spark and hint when room is short.
- **Inheriting a registered property (Chromium 107, and WebKit).** A
  custom property registered as not inherited and taken with `inherit` is
  not restyled when the parent's value changes. 1.2.0-rc.3 did that with
  `--sidebar-width`, and the sidebar couldn't be resized on old WebView2
  and on every Mac; startup's probe passed in WebKit, which still failed
  on a drag. `--sidebar-width` is an ordinary inherited property again.
- **round() (Chromium 125).** The source view centred itself with a
  `round()` that names a `var()`, so the old engine computed its margin to
  0 and the text sat against the left edge. It is behind `@supports` now.
- **dvh (Chromium 108).** Settings and the dialogs ran past both edges of a
  short window (#260, fixed in #314).
- **URL.canParse (Chromium 120).** Mermaid's link sanitizer calls it for
  every http(s) link in a diagram; `utils/polyfills.ts` adds it.

Left as they are, because an old engine just ignores them and loses only
polish: `text-wrap: pretty`, `scrollbar-width` (WebView2 hides those
scrollbars with `::-webkit-scrollbar` too), `transition-behavior`, the
`linear()` springs (behind `@supports` already, with cubic fallbacks), the
accent flash on a located block (`editor/reveal-position.ts`). The source
view can sit half a pixel off centre (the `round()` above), which only
blurred text on WebKitGTK.

Still different in Chromium 107, not fixed yet:

- `Ctrl/⌘ + wheel` zoom in the document doesn't keep the line under the
  pointer in place (e2e `writing.spec.ts`, "zooming keeps the line being
  read in place"). Likely the pre-standard `zoom` of Chromium before 128,
  which places zoomed elements differently; not investigated yet.
- A few colours are flatter than in a current engine, where a plain colour
  can't stand in for a mix: an `h6` is as dark as an `h5`, and a Pele
  diagram's boxes are the same grey tint in light and dark.

## Keeping it working

`src/ui/engine-support.test.ts`, part of `npm run check`, reads the app's
stylesheets and code and fails on:

- CSS newer than Chromium 105 that isn't inside an `@supports` testing for
  it: viewport units such as `dvh`, `round()`, `oklch()` and other new
  colour syntax, `light-dark()`, `linear()`, anchor positioning,
  `@starting-style`, `@scope`, nesting and more (the list is in the test);
- `color-mix()`, `dvh` or the new colour functions written into an inline
  style from the code, which the build doesn't see;
- DOM APIs newer than Chromium 105, such as the popover API or
  `startViewTransition`.

`vite.color-mix-fallback.test.ts` fails on a `color-mix()` the build
can't give a fallback (one inside `@keyframes`).

TypeScript's `lib` (`ES2020` in `tsconfig.json`) keeps newer JavaScript
built-ins such as `Array.prototype.toSorted` or `Object.groupBy` out of our
own code. A dependency can still call one; `utils/polyfills.ts` is where
the fix goes, with the dependency named.

When you need something newer: put it inside `@supports`, with a fallback
outside that still looks right, or, if the old engine can do without it,
add it to the test's list of what may stay, with the reason.

## Testing

Playwright's own Chromium is too new to show any of this. To run the e2e
flows in an old one, download a Chromium build of that version (the
Chromium snapshot archive keeps Linux builds by version) and point the
WebView config at it:

```sh
OLD_CHROMIUM=/path/to/chrome-linux/chrome \
  npx playwright test -c playwright.webview.config.ts settings.spec.ts
```

It builds the frontend as the app ships it, in development mode for the
dev Tauri shim, and serves the build. Screenshots aren't compared there.
CI doesn't run it.
