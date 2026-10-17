// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  synthesize: vi.fn(),
  cancel: vi.fn(async () => {}),
}));
vi.mock("../platform/ipc", () => ({ media: api }));
import { useSpeechPlayback } from "./useSpeechPlayback";
let audios: FakeAudio[];
let pendingPlay: Promise<void> | undefined;
class FakeAudio {
  src = "";
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    audios.push(this);
  }
  play = vi.fn(async () => {
    await pendingPlay;
  });
  pause = vi.fn();
  load = vi.fn();
  removeAttribute() {
    this.src = "";
  }
}
beforeEach(() => {
  audios = [];
  pendingPlay = undefined;
  vi.clearAllMocks();
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:speech");
  URL.revokeObjectURL = vi.fn();
  api.synthesize.mockResolvedValue({
    dataBase64: btoa("audio"),
    mime: "audio/mpeg",
  });
});
it("keeps paused state when an earlier play promise resolves late", async () => {
  let resolve!: () => void;
  pendingPlay = new Promise<void>((r) => {
    resolve = r;
  });
  const { result } = renderHook(() => useSpeechPlayback(true));
  act(() => result.current.start("Read this.", "alloy"));
  await waitFor(() => expect(audios).toHaveLength(1));
  act(() => result.current.pause());
  await act(async () => resolve());
  expect(result.current.state).toBe("paused");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("synthesizes one bounded paragraph at a time and supports pause, resume and stop", async () => {
  const { result } = renderHook(() => useSpeechPlayback(true));
  act(() =>
    result.current.start("First paragraph.\n\nSecond paragraph.", "alloy"),
  );
  await waitFor(() => expect(result.current.state).toBe("playing"));
  expect(api.synthesize).toHaveBeenCalledTimes(1);
  act(() => result.current.pause());
  expect(result.current.state).toBe("paused");
  await act(() => result.current.resume());
  expect(result.current.state).toBe("playing");
  act(() => audios[0].onended?.());
  await waitFor(() => expect(api.synthesize).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(audios).toHaveLength(2));
  act(() => result.current.stop());
  expect(result.current.state).toBe("idle");
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it("ignores a late audio response after stop or document switch", async () => {
  let resolve!: (value: { dataBase64: string; mime: string }) => void;
  api.synthesize.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result, rerender } = renderHook(
    ({ active }) => useSpeechPlayback(active),
    { initialProps: { active: true } },
  );
  act(() => result.current.start("Read this.", "alloy"));
  await waitFor(() => expect(api.synthesize).toHaveBeenCalled());
  rerender({ active: false });
  await act(async () => {
    resolve({ dataBase64: btoa("audio"), mime: "audio/mpeg" });
  });
  expect(api.cancel).toHaveBeenCalled();
  expect(audios).toHaveLength(0);
  expect(result.current.state).toBe("idle");
});
