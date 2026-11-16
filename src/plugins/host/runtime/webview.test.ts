// @vitest-environment jsdom
import { expect, it } from "vitest";
import webview from "./webview.js?raw";

type Handlers = Record<string, (params: unknown) => void>;
type Page = {
  visible: boolean;
  onDidChangeVisibility: (fn: (v: boolean) => void) => { dispose(): void };
  onDidReceiveMessage: (fn: (m: unknown) => void) => { dispose(): void };
  onMessage: (fn: (m: unknown) => void) => { dispose(): void };
};

it("keeps what the plugin sent before the page listens, and logs its errors", () => {
  let handlers: Handlers = {};
  const sent: [string, unknown][] = [];
  const scope = window as unknown as Record<string, unknown>;
  scope.createEndpoint = (_port: unknown, h: Handlers) => {
    handlers = h;
    return {
      notify: (method: string, params: unknown) => sent.push([method, params]),
      call: async () => null,
    };
  };
  scope.localized = (_l: unknown, _lang: string, key: string) => key;
  (0, eval)(webview);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { textus: "init" },
      ports: [new MessageChannel().port1],
    }),
  );
  handlers.message({ message: "early" });
  const page = scope.textus as Page;
  const got: unknown[] = [];
  page.onDidReceiveMessage((m) => got.push(m));
  handlers.message({ message: "later" });
  const old: unknown[] = [];
  page.onMessage((m) => old.push(m));
  handlers.message({ message: "both" });
  expect(got).toEqual(["early", "later", "both"]);
  expect(old).toEqual(["both"]);

  // Told as it goes out of sight, the moment to keep its state.
  const seen: boolean[] = [];
  page.onDidChangeVisibility((v) => seen.push(v));
  handlers.visible({ visible: false });
  handlers.visible({ visible: false });
  handlers.visible({ visible: true });
  expect(seen).toEqual([false, true]);
  expect(page.visible).toBe(true);

  // Its console errors reach the plugin's log.
  console.error("bad", { n: 1 });
  expect(sent).toContainEqual([
    "log",
    { level: "error", message: 'bad {"n":1}' },
  ]);
});
