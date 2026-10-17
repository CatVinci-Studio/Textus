// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transcribe = vi.hoisted(() => vi.fn(async () => "Reviewed text."));
const toWav = vi.hoisted(() =>
  vi.fn(async () => new Blob(["wav"], { type: "audio/wav" })),
);
vi.mock("./recording-wav", () => ({ recordingWav: toWav }));
vi.mock("../platform/ipc", () => ({
  media: { transcribe, cancel: vi.fn(async () => {}) },
}));
import { useRecording } from "./useRecording";
const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;
class Recorder {
  static latest: Recorder;
  constructor() {
    Recorder.latest = this;
  }
  static isTypeSupported() {
    return true;
  }
  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: "audio/webm" }),
    });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("converts MiniMax input locally and uploads WAV only after explicit transcription", async () => {
  const { result } = renderHook(() => useRecording(true, "zh", "minimax"));
  await act(() => result.current.start());
  expect(toWav).not.toHaveBeenCalled();
  act(() => result.current.stopAndTranscribe());
  await waitFor(() => expect(result.current.state).toBe("review"));
  expect(toWav).toHaveBeenCalledOnce();
  expect(transcribe).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    "audio/wav",
    "zh",
  );
});
it("stops at the duration limit without uploading", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useRecording(true, null));
  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(120000));
  expect(result.current.state).toBe("recorded");
  expect(stopTrack).toHaveBeenCalled();
  expect(transcribe).not.toHaveBeenCalled();
});
it("drops oversized chunks without uploading", async () => {
  const { result } = renderHook(() => useRecording(true, null));
  await act(() => result.current.start());
  act(() =>
    Recorder.latest.ondataavailable?.({
      data: new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]),
    }),
  );
  expect(result.current.state).toBe("error");
  expect(transcribe).not.toHaveBeenCalled();
});
it("never uploads on start and leaves transcription in a review state", async () => {
  const { result } = renderHook(() => useRecording(true, null));
  await act(() => result.current.start());
  expect(result.current.state).toBe("recording");
  expect(transcribe).not.toHaveBeenCalled();
  act(() => result.current.stopAndTranscribe());
  await waitFor(() => expect(result.current.state).toBe("review"));
  expect(result.current.text).toBe("Reviewed text.");
  expect(stopTrack).toHaveBeenCalled();
});
it("releases a late permission result after cancellation without recording or uploading", async () => {
  let resolve!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result } = renderHook(() => useRecording(true, null));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.start();
  });
  act(() => result.current.cancel());
  await act(async () => {
    resolve(stream);
    await pending;
  });
  expect(stopTrack).toHaveBeenCalled();
  expect(result.current.state).toBe("idle");
  expect(transcribe).not.toHaveBeenCalled();
});
it("reports permission denial and stops when its document becomes inactive", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  const { result, rerender } = renderHook(
    ({ active }) => useRecording(active, "zh"),
    { initialProps: { active: true } },
  );
  await act(() => result.current.start());
  expect(result.current.state).toBe("error");
  await act(() => result.current.start());
  expect(result.current.state).toBe("recording");
  rerender({ active: false });
  expect(stopTrack).toHaveBeenCalled();
  expect(transcribe).not.toHaveBeenCalled();
});
