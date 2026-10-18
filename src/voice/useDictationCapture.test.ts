// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  options: vi.fn(),
  providers: vi.fn(async () => ({ stt: { provider: "system" } })),
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  recording: {
    state: "idle",
    text: "",
    error: null,
    start: vi.fn(async () => {}),
    cancel: vi.fn(),
    stopAndTranscribe: vi.fn(),
  },
}));
vi.mock("../platform/ipc", () => ({
  dictation: { start: mock.start, stop: mock.stop },
  media: { providers: mock.providers },
}));
vi.mock("./useRecording", () => ({
  useRecording: (...args: unknown[]) => {
    mock.options(...args);
    return mock.recording;
  },
}));
import { useDictationCapture } from "./useDictationCapture";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mock.recording.state = "idle";
  mock.recording.text = "";
});
it("finishes silent native dictation without applying empty text to the captured selection", async () => {
  let callback: (event: {
    text: string;
    done: boolean;
    error: boolean;
  }) => void = () => {};
  mock.providers.mockResolvedValue({ stt: { provider: "system" } });
  mock.start.mockImplementation(async (_language, cb) => {
    callback = cb;
    return 14;
  });
  const apply = vi.fn(() => true),
    finish = vi.fn();
  const { result } = renderHook(() =>
    useDictationCapture(true, "en", () => ({ apply, finish })),
  );
  await act(async () => {});
  await act(async () => result.current.toggle());
  expect(result.current.listening).toBe(true);
  act(() => callback({ text: "", done: true, error: false }));
  expect(apply).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalled();
  expect(result.current.listening).toBe(false);
});
it("remote empty-silence reset restores the microphone button and permits a new capture", async () => {
  mock.providers.mockResolvedValue({ stt: { provider: "minimax" } });
  const apply = vi.fn(() => true);
  const { result, rerender } = renderHook(() =>
    useDictationCapture(true, "en", () => ({ apply })),
  );
  await act(async () => {});
  await act(async () => result.current.toggle());
  mock.recording.state = "recording";
  rerender();
  expect(result.current.listening).toBe(true);
  mock.recording.state = "idle";
  rerender();
  await waitFor(() => expect(result.current.listening).toBe(false));
  expect(apply).not.toHaveBeenCalled();
  await act(async () => result.current.toggle());
  expect(mock.recording.start).toHaveBeenCalledTimes(2);
});

it("leaves remote language automatic and preserves configured native regional locales", async () => {
  mock.providers.mockResolvedValue({ stt: { provider: "minimax" } });
  const remote = renderHook(() =>
    useDictationCapture(true, "en", () => ({ apply: () => true })),
  );
  await act(async () => {});
  expect(mock.options).toHaveBeenLastCalledWith(true, null, "minimax", true);
  remote.unmount();
  mock.providers.mockResolvedValue({
    stt: { provider: "system", language: "zh-TW" },
  } as never);
  mock.start.mockResolvedValue(18);
  const native = renderHook(() =>
    useDictationCapture(true, "en", () => ({ apply: () => true })),
  );
  await act(async () => {});
  await act(async () => native.result.current.toggle());
  expect(mock.start).toHaveBeenLastCalledWith("zh-TW", expect.any(Function));
});
