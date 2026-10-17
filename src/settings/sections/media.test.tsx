// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
beforeEach(() => vi.clearAllMocks());
it("references the existing MiniMax text credential without copying its secret", async () => {
  render(<MediaSettings language="en" />);
  fireEvent.click(await screen.findByText("Speech to text"));
  fireEvent.click(
    screen.getAllByRole("checkbox", {
      name: "Reuse the MiniMax text API key",
    })[0],
  );
  const form = screen.getByRole("form", { name: "Speech to text" });
  expect(form.querySelector('input[type="password"]')).toBeDisabled();
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "stt",
      expect.objectContaining({ credentialSource: "minimax-chat" }),
    ),
  );
  expect(api.setKey).not.toHaveBeenCalled();
});
it("prefills MiniMax native endpoints and models for image generation and speech input", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByText("Speech to text");
  for (const [title, model] of [
    ["Speech to text", "asr-1.0"],
    ["Image generation", "image-01"],
  ]) {
    fireEvent.click(screen.getByText(title));
    const form = screen.getByRole("form", { name: title });
    expect(form.querySelectorAll("input")[0]).toHaveValue(
      "https://api.minimax.cn/v1",
    );
    expect(form.querySelectorAll("input")[1]).toHaveValue(model);
  }
});
it("configures a separate transcription provider and clears the transient API key", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByText("Speech to text");
  fireEvent.click(screen.getByText("Speech to text"));
  const form = screen.getByRole("form", { name: "Speech to text" });
  const inputs = form.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "https://example.com/v1" } });
  fireEvent.change(inputs[1], { target: { value: "whisper-1" } });
  const password = form.querySelector('input[type="password"]')!;
  fireEvent.change(password, { target: { value: "secret-test-key" } });
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.setKey).toHaveBeenCalledWith("stt", "secret-test-key"),
  );
  await waitFor(() => expect(password).toHaveValue(""));
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
