// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorRunner } from "../editor/useEditorRunner";
const api = vi.hoisted(() => ({
  providers: vi.fn(),
  synthesize: vi.fn(),
  cancel: vi.fn(async () => {}),
}));
const target = vi.hoisted(() => ({
  getText: vi.fn((range: string) =>
    range === "selection"
      ? "Selected words."
      : "Before.\n\nSelected words.\n\nAfter.",
  ),
  highlight: vi.fn(() => true),
  clear: vi.fn(),
}));
vi.mock("../platform/ipc", () => ({ media: api }));
vi.mock("./useReadAloudTarget", () => ({ useReadAloudTarget: () => target }));
import { WritePlayback, useWritePlayback } from "./WritePlayback";
const run: EditorRunner = () => undefined;
let rates: number[];
class FakeAudio {
  playbackRate = 1;
  onended = null;
  onerror = null;
  play = vi.fn(async () => {
    rates.push(this.playbackRate);
  });
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
}
beforeEach(() => {
  vi.clearAllMocks();
  rates = [];
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:speech");
  URL.revokeObjectURL = vi.fn();
  api.providers.mockResolvedValue({
    tts: { voice: "configured-voice", playbackRate: 1.4, language: "zh" },
  });
  api.synthesize.mockResolvedValue({
    dataBase64: btoa("audio"),
    mime: "audio/mpeg",
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Controls() {
  const reader = useWritePlayback(run, true);
  return <WritePlayback reader={reader} language="en" />;
}
it("offers a compact whole-document action without configuration fields", async () => {
  const { container } = render(<Controls />);
  expect(
    container.querySelectorAll("input, select, details, textarea"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Read document aloud" }));
  await waitFor(() => expect(api.synthesize).toHaveBeenCalled());
  expect(target.getText).toHaveBeenCalledWith("document");
  // Short neighbouring paragraphs share one request.
  expect(api.synthesize.mock.calls[0][1]).toMatch(/^Before\./);
  expect(api.synthesize.mock.calls[0][2]).toBe("configured-voice");
  await waitFor(() => expect(rates).toEqual([1.4]));
  expect(screen.getByRole("button", { name: "Stop reading" })).toBeTruthy();
});
it("sends only the selection and reloads the configured voice for the next start", async () => {
  const { result } = renderHook(() => useWritePlayback(run, true));
  await act(() => result.current.start("selection"));
  expect(api.synthesize.mock.calls[0].slice(1)).toEqual([
    "Selected words.",
    "configured-voice",
  ]);
  act(() => window.dispatchEvent(new Event("textus-media-settings-change")));
  expect(result.current.state).toBe("idle");
  api.providers.mockResolvedValue({
    tts: { voice: "new-voice", playbackRate: 0.8 },
  });
  await act(() => result.current.start("selection"));
  expect(api.synthesize.mock.calls[1].slice(1)).toEqual([
    "Selected words.",
    "new-voice",
  ]);
});
it("cancels a pending configuration read when the document or surface changes", async () => {
  let resolve!: (config: object) => void;
  api.providers.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result, rerender } = renderHook(
    ({ active }) => useWritePlayback(run, active),
    { initialProps: { active: true } },
  );
  act(() => {
    void result.current.start("selection");
  });
  rerender({ active: false });
  await act(async () => resolve({ tts: { voice: "late" } }));
  expect(api.synthesize).not.toHaveBeenCalled();
});
