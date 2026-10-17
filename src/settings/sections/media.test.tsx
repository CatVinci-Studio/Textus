// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  providers: vi.fn(async () => ({})),
  keyStatus: vi.fn(async () => false),
  setKey: vi.fn(async () => {}),
  clearKey: vi.fn(async () => {}),
  configure: vi.fn(async () => {}),
}));
vi.mock("../../platform/ipc", () => ({ media: api }));
import { MediaSettings } from "./media";
afterEach(cleanup);
it("configures a separate transcription provider and clears the transient API key", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByText("Speech to text");
  fireEvent.click(screen.getByText("Speech to text"));
  const form = screen.getByRole("form", { name: "Speech to text" });
  const inputs = form.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "https://example.com/v1" } });
  fireEvent.change(inputs[1], { target: { value: "whisper-1" } });
  fireEvent.change(inputs[2], { target: { value: "secret-test-key" } });
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.setKey).toHaveBeenCalledWith("stt", "secret-test-key"),
  );
  await waitFor(() => expect(inputs[2]).toHaveValue(""));
  expect(api.configure).toHaveBeenCalledWith(
    "stt",
    expect.objectContaining({
      model: "whisper-1",
      endpoint: "https://example.com/v1",
    }),
  );
  expect(JSON.stringify(api.configure.mock.calls)).not.toContain(
    "secret-test-key",
  );
});
