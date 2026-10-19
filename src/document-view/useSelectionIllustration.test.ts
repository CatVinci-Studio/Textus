// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
const api = vi.hoisted(() => ({
  agentMessage: vi.fn(),
  cancelAgentMessage: vi.fn(async () => {}),
  providers: vi.fn(),
}));
vi.mock("../platform/ipc", () => ({
  ai: api,
  media: { providers: api.providers },
}));
import { createTestEditor } from "./editor-test-harness";
import { useSelectionIllustration } from "./useSelectionIllustration";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../settings/SettingsContext";
import type { useDocumentImages } from "./useDocumentImages";
let editor: Editor | undefined;
afterEach(async () => {
  cleanup();
  await editor?.destroy();
  editor = undefined;
  vi.resetAllMocks();
});
async function setup() {
  editor = await createTestEditor(
    "Forest passage.\n\nPrivate unselected paragraph.",
  );
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 16)),
    );
  });
  const start = vi.fn(async () => undefined);
  const images = {
    pending: false,
    jobs: [],
    start,
    accept: vi.fn(),
    cancel: vi.fn(),
    isLive: () => true,
    holdPlaceholder: vi.fn(() => () => {}),
  } as unknown as ReturnType<typeof useDocumentImages>;
  const settings = {
    language: "en",
    aiProvider: "custom",
    agentModels: {},
  } as unknown as Settings;
  const hook = renderHook(() =>
    useSelectionIllustration(run, settings, images, "doc"),
  );
  return { ...hook, start, run };
}
it("rejects missing image settings before invoking paid prompt refinement", async () => {
  api.providers.mockResolvedValue({});
  const { result, start } = await setup();
  await act(async () => result.current.create());
  expect(result.current.error).toContain("Configure image generation");
  expect(api.agentMessage).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});
it("condenses an oversized prompt on the built-in agent with only the selected source", async () => {
  api.providers.mockResolvedValue({ image: { provider: "minimax" } });
  api.agentMessage
    .mockResolvedValueOnce([{ kind: "Assistant", text: "x".repeat(1600) }])
    .mockResolvedValueOnce([
      { kind: "Assistant", text: "Polished forest composition" },
    ]);
  const { result, start } = await setup();
  await act(async () => result.current.create());
  expect(api.agentMessage).toHaveBeenCalledTimes(2);
  for (const [request] of api.agentMessage.mock.calls) {
    expect(request.engine).toBeUndefined();
    expect(request.document).toBe("Forest passage.");
    expect(request.document).not.toContain("Private");
  }
  // Nothing is generated until the user approves the drafted prompt.
  expect(start).not.toHaveBeenCalled();
  expect(result.current.review).toMatchObject({
    prompt: "Polished forest composition",
    anchor: "Forest passage.",
  });
  await act(async () => result.current.approve("Polished forest composition"));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "Polished forest composition",
      anchor: "Forest passage.",
    }),
    { live: true },
  );
});
it("keeps the illustration when the document is edited during refinement", async () => {
  api.providers.mockResolvedValue({ image: { provider: "minimax" } });
  let resolve: (value: unknown) => void = () => {};
  api.agentMessage.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result, run, start } = await setup();
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.create();
    await Promise.resolve();
  });
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("Edit", 1));
  });
  await act(async () => {
    resolve([{ kind: "Assistant", text: "Forest" }]);
    await pending;
  });
  // Approved later, inserted by its captured anchor against the live
  // document.
  expect(result.current.review).toMatchObject({
    prompt: "Forest",
    anchor: "Forest passage.",
  });
  await act(async () => result.current.approve("An edited forest prompt"));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "An edited forest prompt",
      anchor: "Forest passage.",
    }),
    { live: true },
  );
  expect(result.current.error).toBeNull();
});
