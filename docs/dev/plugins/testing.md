# Testing a plugin

## While you write it

Load its folder (**Settings › Extensions › Plugins**, **More** ›
**Load a plugin folder…**): Textus reads it again each time a file
changes, and the plugin's page in Settings shows what it logged with
`ctx.log` and any error it threw. A plugin that throws more than ten errors
a minute is turned off.

Before installing anything, Textus reads the plugin's code and names what
would fail or do nothing: a call whose permission the manifest leaves out,
a command or view declared but never registered, a menu condition Textus
never sets, code in `host.js` that reaches for the page (it runs in a
hidden frame). Plugins Textus AI writes in Create mode are checked the
same way before they reach you.

## Unit tests

Keep what decides things in plain functions with no `textus` in them - a
parser, a date rule, what a list shows - and test those with any test
runner. The official plugins do this with Vitest: a module such as
`timer.js` sets `globalThis.pomodoro`, and a test imports the file and
calls it.

## The host, without Textus

textus-plugins' `packages/textus-plugin/test.mjs` runs a plugin's folder
against a stand-in `textus`, outside the app; copy the package folder (it needs nothing else) into your project:

```js
// test.mjs from textus-plugins' packages/textus-plugin, copied or linked
import { loadPlugin } from "./textus-plugin/test.mjs";
const plugin = loadPlugin("./my-plugin", {
  settings: { get: async () => "TOC = table of contents" },
});
await plugin.activate();
await plugin.callTool("look_up_term", { term: "toc" });
await plugin.run("jane.my-plugin.count");
```

What you give in the second argument answers; any other call the plugin
API has does nothing, and a call it doesn't have throws, as it would in
Textus. `plugin.registered` holds what the plugin registered, by kind and
id. The official plugins' own tests use a fuller one, `tests/plugin-host.ts`,
with an in-memory folder and the same `dates` and `templates` as Textus.

Before you publish, `node packages/textus-plugin/cli.mjs check my-plugin`
runs the install checks over the folder.

## In the app

Textus's own end-to-end tests install a plugin into the app in a browser
(the app's `e2e/plugin-helpers.ts`, `e2e/plugin-text-api.spec.ts`) and
drive it like a user. Drag with real mouse moves there, and call
`swallowHtmlDrop(page)` first: the app's window takes HTML drag and drop
for files, and the helper makes the browser do the same, so a drag that
passes the test works in the app.

## On iPhone and iPad

A plugin offered on iOS (`"platforms": ["desktop", "ios"]`) should be
tried at phone width - about 390 px, touch targets of 44 px - or in the
simulator before it is published.
