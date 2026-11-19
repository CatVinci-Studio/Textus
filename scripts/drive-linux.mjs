#!/usr/bin/env node
// Drives the built app on Linux through tauri-driver (WebKitWebDriver):
// it starts on a document, takes typing and saves it to disk. What the
// Playwright suite (a browser against the dev server) can't show: the
// real window, its webview and the Rust side behind the save.
//
// Usage: tauri-driver running on :4444, then
//   node scripts/drive-linux.mjs <app binary>
// Run it with throwaway XDG_CONFIG_HOME / XDG_DATA_HOME, as CI does.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("usage: drive-linux.mjs <app binary>");
  process.exit(2);
}
const DRIVER = "http://127.0.0.1:4444";
const ELEMENT = "element-6066-11e4-a4ab-4bf4d6d5cf0e";
const CONTROL = "";
const END = "";

async function call(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json.value;
}

/** Waits up to `seconds` for `check` to give something. */
async function until(what, seconds, check) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const found = await check().catch(() => null);
    if (found) return found;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const dir = mkdtempSync(join(tmpdir(), "textus-drive-"));
const doc = join(dir, "driven.md");
writeFileSync(doc, "# Driven\n\nStarted on this line.\n");

const { sessionId } = await call("POST", "/session", {
  capabilities: {
    alwaysMatch: { "tauri:options": { application: app, args: [doc] } },
  },
});
const s = `/session/${sessionId}`;
/** The element `css` finds: its reference, under the W3C key or the one
 *  older drivers use. */
const find = async (css) => {
  const found = await call("POST", `${s}/element`, {
    using: "css selector",
    value: css,
  });
  const id =
    found?.[ELEMENT] ?? found?.ELEMENT ?? Object.values(found ?? {})[0];
  if (!id) throw new Error(`${css}: ${JSON.stringify(found)}`);
  return id;
};
const run = (script, ...args) =>
  call("POST", `${s}/execute/sync`, { script, args });
const keys = (...values) =>
  call("POST", `${s}/actions`, {
    actions: [
      {
        type: "key",
        id: "keys",
        actions: [
          ...values.map((value) => ({ type: "keyDown", value })),
          ...values.reverse().map((value) => ({ type: "keyUp", value })),
        ],
      },
    ],
  });

try {
  // A first start asks for the language first.
  const welcome = await until("the window", 60, () =>
    run(
      "return document.querySelector('.language-welcome-continue') ? 'welcome' : document.querySelector('.ProseMirror') ? 'editor' : null",
    ),
  );
  if (welcome === "welcome")
    await call(
      "POST",
      `${s}/element/${await find(".language-welcome-continue")}/click`,
      {},
    );
  await until("the document opened", 30, () =>
    run(
      "return [...document.querySelectorAll('.ProseMirror')].some((e) => e.textContent.includes('Started on this line'))",
    ),
  );
  console.log("ok   started on the document");

  const editor = await find("[data-active-tab='true'] .ProseMirror");
  await call("POST", `${s}/element/${editor}/click`, {});
  await keys(CONTROL, END);
  await call("POST", `${s}/element/${editor}/value`, {
    text: " Typed by the driver.",
  });
  await until("the typing shown", 10, () =>
    run(
      "return document.querySelector(\"[data-active-tab='true'] .ProseMirror\").textContent.includes('Typed by the driver')",
    ),
  );
  console.log("ok   typed into it");

  await keys(CONTROL, "s");
  await until("the file saved", 15, async () =>
    readFileSync(doc, "utf8").includes("Typed by the driver."),
  );
  console.log("ok   saved to disk");
} finally {
  await call("DELETE", s).catch(() => {});
}
