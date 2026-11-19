// @vitest-environment jsdom
import { ESLint } from "eslint";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { TEXT_RUNTIME as text } from "../text-runtime";
import { HOST_RUNTIME as host } from "../host-runtime";

type PathTools = {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  relative(from: string, to: string): string;
  normalize(path: string): string;
};

type Textus = {
  path: PathTools;
  files: { onDidSave: (fn: () => void) => { dispose(): void } };
  editor: {
    registerHover: (p: object) => { dispose(): void };
    registerBlockType: (id: string, t: object) => { dispose(): void };
  };
  net: {
    fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>;
  };
  ai: {
    stream: (
      r: object,
      onText: (t: string) => void,
      o?: { signal?: AbortSignal },
    ) => Promise<string>;
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
  const hover = textus.editor.registerHover({ provideHover: () => null });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent.filter(([m]) => m === "log")).toHaveLength(2);
  expect(sent[0][1]).toEqual({
    level: "error",
    message: "acme.x was not granted files.read",
  });
  // Its last provider gone, the app stops asking it.
  const asked: string[] = [];
  answer = async (method) => {
    asked.push(method);
    return null;
  };
  hover.dispose();
  const block = textus.editor.registerBlockType("box", {
    label: "Box",
    insert: () => {},
  });
  block.dispose();
  expect(asked).toEqual([
    "editor.unregisterHover",
    "editor.registerBlockType",
    "editor.unregisterBlockType",
  ]);
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
  // A question to the AI model stops the same way.
  sent = [];
  const answering = new AbortController();
  const streamed = textus.ai.stream({ prompt: "hi" }, () => {}, {
    signal: answering.signal,
  });
  answering.abort();
  await expect(streamed).rejects.toMatchObject({ name: "AbortError" });
  expect(sent).toEqual([["net.cancel", { cancelId: asked.cancelId }]]);
});

it('works paths out in the frame, with "/" on every system', () => {
  const p = textus.path;
  expect(p.join("notes", "daily/", "../2026-11-16.md")).toBe(
    "notes/2026-11-16.md",
  );
  expect(p.join("/Users/me", "vault", "a.md")).toBe("/Users/me/vault/a.md");
  expect(p.normalize("C:\\notes\\.\\a.md")).toBe("C:/notes/a.md");
  expect(p.dirname("notes/daily/a.md")).toBe("notes/daily");
  expect(p.dirname("/a.md")).toBe("/");
  expect(p.dirname("a.md")).toBe(".");
  expect(p.basename("notes/a.md")).toBe("a.md");
  expect(p.basename("notes/a.md", ".md")).toBe("a");
  expect(p.extname("notes/a.tar.gz")).toBe(".gz");
  expect(p.extname("notes/.textus")).toBe("");
  expect(p.relative("notes/daily", "notes/ideas/a.md")).toBe("../ideas/a.md");
  expect(p.relative("notes", "notes")).toBe(".");
  // A provider's address keeps its "scheme://host/" as its root.
  expect(p.join("ssh://box/home", "../notes", "a.md")).toBe(
    "ssh://box/notes/a.md",
  );
  expect(p.normalize("ssh://box/../a.md")).toBe("ssh://box/a.md");
  expect(p.dirname("ssh://box/a.md")).toBe("ssh://box/");
  expect(p.dirname("ssh://box/notes/a.md")).toBe("ssh://box/notes");
  expect(p.dirname("C:/a.md")).toBe("C:/");
  expect(sent).toEqual([]);
});

const LINT_TIMEOUT = 30_000;

it(
  "is one clean script once its parts are joined",
  async () => {
    // The parts use what the others define, so they are linted as one.
    const [result] = await new ESLint().lintText(host, {
      filePath: "src/plugins/host/runtime/host.js",
    });
    expect(result.messages.map((m) => `${m.line}: ${m.message}`)).toEqual([]);
  },
  // Starts ESLint and its TypeScript parser cold: seconds on a busy runner.
  LINT_TIMEOUT,
);
