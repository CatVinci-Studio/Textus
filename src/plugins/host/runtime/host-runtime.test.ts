// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it } from "vitest";
import text from "./text.js?raw";
import host from "./host.js?raw";

type Textus = {
  files: { onDidSave: (fn: () => void) => { dispose(): void } };
  editor: { registerHover: (p: object) => { dispose(): void } };
  net: {
    fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>;
  };
};

// What the plugin's code sends the app, and how the app answers a call.
let sent: [string, unknown][] = [];
let answer: (method: string, params: unknown) => Promise<unknown>;
let textus: Textus;

beforeAll(() => {
  const scope = window as unknown as Record<string, unknown>;
  scope.createEndpoint = () => ({
    notify: (method: string, params: unknown) => sent.push([method, params]),
    call: (method: string, params: unknown) => answer(method, params),
  });
  scope.localized = (_l: unknown, _lang: string, key: string) => key;
  (0, eval)(`${text}\n${host}`);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { textus: "init", env: {} },
      ports: [new MessageChannel().port1],
    }),
  );
  textus = scope.textus as Textus;
});

beforeEach(() => {
  sent = [];
  answer = async () => null;
});

it("tells the plugin's log when a permission refuses an event or a provider", async () => {
  answer = async (method) => {
    if (method === "events.subscribe" || method === "editor.registerHover")
      throw new Error("acme.x was not granted files.read");
    return null;
  };
  textus.files.onDidSave(() => {});
  textus.editor.registerHover({ provideHover: () => null });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent.filter(([m]) => m === "log")).toHaveLength(2);
  expect(sent[0][1]).toEqual({
    level: "error",
    message: "acme.x was not granted files.read",
  });
});

it("stops a fetch whose signal aborts, in the app too", async () => {
  let asked: { cancelId?: string } = {};
  answer = (_method, params) => {
    asked = params as { cancelId?: string };
    // The app's answer once the request is cancelled there.
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error("cancelled")), 10),
    );
  };
  const stop = new AbortController();
  const fetched = textus.net.fetch("https://example.com/", {
    signal: stop.signal,
  });
  stop.abort();
  await expect(fetched).rejects.toMatchObject({ name: "AbortError" });
  expect(asked.cancelId).toBeTruthy();
  expect(sent).toEqual([["net.cancel", { cancelId: asked.cancelId }]]);
  // Aborted before it starts: never sent.
  await expect(
    textus.net.fetch("https://example.com/", { signal: stop.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
