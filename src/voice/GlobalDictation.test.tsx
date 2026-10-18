// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
const native = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
}));
vi.mock("../platform/ipc", () => ({
  dictation: native,
  media: { providers: vi.fn(async () => ({})), cancel: vi.fn() },
}));
import { GlobalDictation, captureTextInput } from "./GlobalDictation";
import {
  captureDictationTarget,
  registerDictationTarget,
} from "./dictation-target";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("dictates into a controlled text field, replacing selection and repeated partials", async () => {
  let update: (event: {
    text: string;
    done: boolean;
    error: boolean;
  }) => void = () => {};
  native.start.mockImplementation(async (_lang, callback) => {
    update = callback;
    return 12;
  });
  function Form() {
    const [text, setText] = useState("before old after");
    return (
      <>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <GlobalDictation language="en" />
      </>
    );
  }
  render(<Form />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  vi.spyOn(field, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  field.setSelectionRange(7, 10);
  await act(async () => {
    fireEvent.focusIn(field);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
  });
  act(() => update({ text: "hello", done: false, error: false }));
  expect(field.value).toBe("before hello after");
  act(() => update({ text: "hello world", done: false, error: false }));
  expect(field.value).toBe("before hello world after");
  fireEvent.change(field, { target: { value: "manual" } });
  act(() => update({ text: "late", done: false, error: false }));
  expect(field.value).toBe("manual");
  expect(native.stop).toHaveBeenCalledWith(12);
});
it("never offers dictation for passwords or its own inline composer", () => {
  render(
    <>
      <input type="password" aria-label="key" />
      <div className="inline-chat-input">
        <textarea />
      </div>
      <GlobalDictation language="en" />
    </>,
  );
  fireEvent.focusIn(screen.getByLabelText("key"));
  expect(screen.queryByRole("button", { name: "Voice input" })).toBeNull();
  fireEvent.focusIn(screen.getByRole("textbox"));
  expect(screen.queryByRole("button", { name: "Voice input" })).toBeNull();
});
it("target registry walks ancestors, unregisters and text sessions revoke ownership", () => {
  const root = document.createElement("div"),
    child = document.createElement("span");
  root.append(child);
  const session = { apply: vi.fn(() => true) };
  const unregister = registerDictationTarget(root, () => session);
  expect(captureDictationTarget(child)).toBe(session);
  unregister();
  expect(captureDictationTarget(child)).toBeNull();
  const field = document.createElement("textarea");
  document.body.append(field);
  field.value = "hi";
  const captured = captureTextInput(field);
  expect(captured.apply("ok")).toBe(true);
  captured.finish?.();
  expect(captured.apply("late")).toBe(false);
  field.remove();
});
