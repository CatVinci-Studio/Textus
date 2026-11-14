// @vitest-environment jsdom
import { expect, it } from "vitest";
import text from "./text.js?raw";
import host from "./host.js?raw";

type Textus = {
  files: { onDidSave: (fn: () => void) => { dispose(): void } };
  editor: { registerHover: (p: object) => { dispose(): void } };
};

it("tells the plugin's log when a permission refuses an event or a provider", async () => {
  const sent: [string, unknown][] = [];
  const scope = window as unknown as Record<string, unknown>;
  scope.createEndpoint = () => ({
    notify: (method: string, params: unknown) => sent.push([method, params]),
    call: async (method: string) => {
      if (method === "events.subscribe" || method === "editor.registerHover")
        throw new Error("acme.x was not granted files.read");
      return null;
    },
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
  const textus = scope.textus as Textus;
  textus.files.onDidSave(() => {});
  textus.editor.registerHover({ provideHover: () => null });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent.filter(([m]) => m === "log")).toHaveLength(2);
  expect(sent[0][1]).toEqual({
    level: "error",
    message: "acme.x was not granted files.read",
  });
});
