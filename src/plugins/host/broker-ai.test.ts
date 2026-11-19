import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  aiStatus: vi.fn(async () => ({
    on: true,
    allowed: false,
    used: 0,
    limit: 100000,
  })),
  aiAllow: vi.fn(async () => null),
  aiComplete: vi.fn(),
  aiStream: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({ plugins: ipc }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("../../engine/controls/app-dialog", () => ({ showConfirm: confirm }));

import en from "../../i18n/locales/en";
import { aiModelHandlers, promptOf, stopPluginAi } from "./broker-ai";
import { chosenSource } from "../../ai/writing/inline-sources";
import type { PluginScope } from "./broker-scope";

const scope = {
  id: "a.translate",
  name: () => "Translate",
  t: () => en,
} as unknown as PluginScope;

describe("a plugin asking the user's AI model", () => {
  it("sends one question as it is, a conversation as turns", () => {
    expect(promptOf("Hi")).toBe("Hi");
    expect(
      promptOf([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Again" },
      ]),
    ).toBe("User: Hi\n\nAssistant: Hello\n\nUser: Again\n\nAssistant:");
    expect(() => promptOf([{ role: "system", content: "x" }])).toThrow();
  });

  it("asks the user on the first call, then asks the model", async () => {
    ipc.aiComplete
      .mockRejectedValueOnce("plugin-ai-not-allowed")
      .mockResolvedValueOnce("Bonjour");
    confirm.mockResolvedValueOnce(true);
    const complete = aiModelHandlers(scope)["ai.complete"];
    await expect(
      complete({ system: "Translate to French.", messages: "Hello" }),
    ).resolves.toBe("Bonjour");
    expect(confirm.mock.calls[0][0]).toContain("Translate wants to use");
    expect(ipc.aiAllow).toHaveBeenCalledWith("a.translate", false);
  });

  it("streams the answer to the plugin piece by piece, asked as complete is", async () => {
    ipc.aiStream
      .mockRejectedValueOnce("plugin-ai-not-allowed")
      .mockImplementationOnce(async (_p, _s, _m, onText) => {
        onText("Bon");
        onText("jour");
        return "Bonjour";
      });
    confirm.mockResolvedValueOnce(true);
    const request = vi.fn(async () => null);
    const stream = aiModelHandlers({ ...scope, request } as PluginScope)[
      "ai.stream"
    ];
    await expect(stream({ messages: "Hello", stream: "1" })).resolves.toBe(
      "Bonjour",
    );
    expect(request.mock.calls).toEqual([
      ["$aiStreamText", { stream: "1", text: "Bon" }],
      ["$aiStreamText", { stream: "1", text: "jour" }],
    ]);
  });

  it("stops when the user says no, and asks for more at the limit", async () => {
    ipc.aiComplete.mockRejectedValueOnce("plugin-ai-limit");
    confirm.mockResolvedValueOnce(false);
    const complete = aiModelHandlers(scope)["ai.complete"];
    await expect(complete({ messages: "Hello" })).rejects.toThrow(
      "didn't allow",
    );
    expect(confirm.mock.calls.at(-1)?.[0]).toContain("Allow 100,000 more?");
  });
});

it("offers a plugin's inline completion until the plugin stops", async () => {
  const request = vi.fn(async () => "rhymes with moon");
  const handlers = aiModelHandlers({ ...scope, request } as PluginScope);
  handlers["ai.registerInlineCompletion"]({ id: "rhyme", label: "Rhymes" });
  const source = chosenSource("a.translate#rhyme");
  if (!source || source === "textus") throw new Error("not offered");
  expect(source.label).toBe("Rhymes");
  await expect(
    source.provide({ before: "June", after: "", path: null }),
  ).resolves.toBe("rhymes with moon");
  expect(request).toHaveBeenCalledWith("$inlineCompletion", {
    id: "rhyme",
    before: "June",
    after: "",
    path: null,
  });
  expect(chosenSource("textus")).toBe("textus");
  stopPluginAi("a.translate");
  // Gone: nothing is offered, not Textus AI in its place.
  expect(chosenSource("a.translate#rhyme")).toBeNull();
});

it("puts a plugin's export format in File › Export until it stops", async () => {
  const { exportFormatHandlers, stopPluginExport } =
    await import("./broker-export");
  const { pluginFormat } = await import("../../registry/plugin-export-formats");
  const request = vi.fn(async () => new Uint8Array([1, 2]));
  const handlers = exportFormatHandlers({ ...scope, request } as PluginScope);
  expect(() =>
    handlers["export.registerFormat"]({ id: "x", extension: "../x" }),
  ).toThrow();
  handlers["export.registerFormat"]({ id: "docx", extension: ".DOCX" });
  const format = pluginFormat("a.translate#docx");
  expect(format?.extension).toBe("docx");
  expect(format?.label).toBe("DOCX");
  await expect(
    format!.run({ markdown: "# Hi", html: "<h1>Hi</h1>", path: null }),
  ).resolves.toEqual(new Uint8Array([1, 2]));
  stopPluginExport("a.translate");
  expect(pluginFormat("a.translate#docx")).toBeUndefined();
});
