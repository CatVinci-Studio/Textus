// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import type { DictationEvent } from "../platform/ipc";
const native = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
}));
vi.mock("../platform/ipc", () => ({
  dictation: native,
  media: { cancel: vi.fn() },
}));
import { InlineDictation } from "./InlineDictation";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Input() {
  const [value, setValue] = useState("before  after");
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <InlineDictation
        active
        language="en"
        value={value}
        inputRef={ref}
        onChange={setValue}
      />
      <button>Another input</button>
    </>
  );
}
it("replaces partial results, retains surrounding text and ignores late results after edits", async () => {
  let callback: ((event: DictationEvent) => void) | undefined;
  native.start.mockImplementation(async (_lang, cb) => {
    callback = cb;
    return 42;
  });
  render(<Input />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(7, 7);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
  });
  act(() => callback?.({ text: "你好", done: false, error: false }));
  expect(input.value).toBe("before 你好 after");
  act(() => callback?.({ text: "你好世界", done: false, error: false }));
  expect(input.value).toBe("before 你好世界 after");
  fireEvent.change(input, { target: { value: "Manual change" } });
  act(() => callback?.({ text: "Late speech", done: false, error: false }));
  expect(input.value).toBe("Manual change");
  expect(native.stop).toHaveBeenCalledWith(42);
});
it("releases the microphone when focus leaves the input and discards later partials", async () => {
  let callback: ((event: DictationEvent) => void) | undefined;
  native.start.mockImplementation(async (_lang, cb) => {
    callback = cb;
    return 24;
  });
  render(<Input />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
  });
  fireEvent.focusIn(screen.getByRole("button", { name: "Another input" }));
  act(() => callback?.({ text: "Late", done: false, error: false }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "before  after",
  );
  expect(native.stop).toHaveBeenCalledWith(24);
});
it("Escape ends capture and fences later partial transcripts", async () => {
  let callback: ((event: DictationEvent) => void) | undefined;
  native.start.mockImplementation(async (_lang, cb) => {
    callback = cb;
    return 77;
  });
  render(<Input />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
  });
  fireEvent.keyDown(window, { key: "Escape" });
  act(() => callback?.({ text: "Late speech", done: false, error: false }));
  expect(native.stop).toHaveBeenCalledWith(77);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "before  after",
  );
});
