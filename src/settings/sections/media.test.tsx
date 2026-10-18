// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MediaProviders } from "../../platform/ipc";
const api = vi.hoisted(() => ({
  providers: vi.fn<() => Promise<MediaProviders>>(async () => ({})),
  keyStatus: vi.fn(async () => false),
  setKey: vi.fn(async () => {}),
  clearKey: vi.fn(async () => {}),
  configure: vi.fn(async () => {}),
}));
vi.mock("../../platform/ipc", () => ({ media: api }));
import { MediaSettings } from "./media";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.providers.mockResolvedValue({});
  api.keyStatus.mockResolvedValue(false);
});
async function choose(label: string, value: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
}
it("saves system dictation without URL, model fields, or credentials", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  expect(
    screen.queryByRole("textbox", { name: "Model" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("tabpanel").querySelector('input[type="password"]'),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "stt",
      expect.objectContaining({
        provider: "system",
        endpoint: "",
        model: "system",
        voice: null,
      }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});
it("switches providers with capability-specific models and hides unsupported presets", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  await choose("Service", "OpenAI");
  expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue(
    "gpt-4o-mini-transcribe",
  );
  fireEvent.click(screen.getByRole("tab", { name: /Illustrations/ }));
  fireEvent.click(screen.getByRole("combobox", { name: "Service" }));
  expect(
    screen.queryByRole("option", { name: "ElevenLabs" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Groq" }),
  ).not.toBeInTheDocument();
});
it("keeps saved speech settings and shows unsaved state after edits", async () => {
  api.providers.mockResolvedValue({
    tts: {
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      model: "tts-1",
      voice: "nova",
      language: "zh-CN",
      playbackRate: 1.25,
    },
  });
  render(<MediaSettings language="en" />);
  fireEvent.click(await screen.findByRole("tab", { name: /Read/ }));
  expect(screen.getByRole("textbox", { name: "Voice" })).toHaveValue("nova");
  expect(screen.getByRole("textbox", { name: "Language" })).toHaveValue(
    "zh-CN",
  );
  expect(screen.getByRole("combobox", { name: "Speed" })).toHaveTextContent(
    "1.25×",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Voice" }), {
    target: { value: "alloy" },
  });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "tts",
      expect.objectContaining({
        voice: "alloy",
        playbackRate: 1.25,
        language: "zh-CN",
      }),
    ),
  );
});
it("never fills stored keys and retains them when saving an empty password", async () => {
  api.keyStatus.mockResolvedValue(true);
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  await choose("Service", "OpenAI");
  const password = within(screen.getByRole("tabpanel")).getByLabelText(
    "API key",
  );
  await waitFor(() =>
    expect(password).toHaveAttribute("placeholder", "•••••••• · Stored"),
  );
  expect(password).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved", { selector: '[role="status"]' });
  expect(api.setKey).not.toHaveBeenCalled();
  expect(api.clearKey).not.toHaveBeenCalled();
});
it("reuses MiniMax text credentials without copying the secret", async () => {
  render(<MediaSettings language="en" />);
  fireEvent.click(await screen.findByRole("tab", { name: /Read/ }));
  await choose("Service", "MiniMax");
  expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue(
    "speech-2.8-hd",
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Reuse MiniMax text key" }),
  );
  expect(
    within(screen.getByRole("tabpanel")).getByLabelText("API key"),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "tts",
      expect.objectContaining({ credentialSource: "minimax-chat" }),
    ),
  );
  expect(api.setKey).not.toHaveBeenCalled();
});
it("clears transient keys after save and keeps secrets out of config", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  await choose("Service", "OpenAI");
  fireEvent.change(
    within(screen.getByRole("tabpanel")).getByLabelText("API key"),
    { target: { value: "secret-test-key" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.setKey).toHaveBeenCalledWith("stt", "secret-test-key"),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("tabpanel")).getByLabelText("API key"),
    ).toHaveValue(""),
  );
  expect(JSON.stringify(api.configure.mock.calls)).not.toContain(
    "secret-test-key",
  );
});

it("preserves drafts between tabs and reflects disable in the capability card", async () => {
  api.providers.mockResolvedValue({
    tts: {
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      model: "tts-1",
      voice: "nova",
    },
  });
  render(<MediaSettings language="en" />);
  fireEvent.click(await screen.findByRole("tab", { name: /Read/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Voice" }), {
    target: { value: "alloy" },
  });
  fireEvent.click(screen.getByRole("tab", { name: /Listen/ }));
  fireEvent.click(screen.getByRole("tab", { name: /Read/ }));
  expect(screen.getByRole("textbox", { name: "Voice" })).toHaveValue("alloy");
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith("tts", null));
  expect(screen.getByRole("tab", { name: /Read/ })).toHaveTextContent("Off");
});
it("resets transient credentials and endpoint when changing service", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  await choose("Service", "OpenAI");
  fireEvent.change(
    within(screen.getByRole("tabpanel")).getByLabelText("API key"),
    { target: { value: "temporary-secret" } },
  );
  await choose("Service", "ElevenLabs");
  expect(
    within(screen.getByRole("tabpanel")).getByLabelText("API key"),
  ).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue(
    "scribe_v2",
  );
  fireEvent.click(screen.getAllByText("Connection details")[0]);
  expect(screen.getByRole("textbox", { name: "API base URL" })).toHaveValue(
    "https://api.elevenlabs.io/v1",
  );
});
it("saves the dictation language for on-device recognition", async () => {
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  fireEvent.change(screen.getByRole("textbox", { name: "Language" }), {
    target: { value: "zh-CN" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "stt",
      expect.objectContaining({
        provider: "system",
        endpoint: "",
        model: "system",
        language: "zh-CN",
      }),
    ),
  );
});
it("switches capability tabs with the keyboard", async () => {
  render(<MediaSettings language="en" />);
  const listen = await screen.findByRole("tab", { name: /Listen/ });
  fireEvent.keyDown(listen, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: /Read/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: /Read/ })).toHaveFocus();
});
it("shows system as the effective default when dictation is unconfigured", async () => {
  render(<MediaSettings language="en" />);
  const listen = await screen.findByRole("tab", { name: /Listen/ });
  expect(listen).toHaveTextContent("System · default");
  expect(listen).not.toHaveTextContent("Off");
  expect(
    screen.queryByRole("button", { name: "Disable" }),
  ).not.toBeInTheDocument();
});
it("resets remote dictation to system instead of claiming to disable dictation", async () => {
  api.providers.mockResolvedValue({
    stt: {
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini-transcribe",
      voice: null,
      language: "zh-CN",
    },
  });
  render(<MediaSettings language="en" />);
  await screen.findByRole("tab", { name: /Listen/ });
  expect(
    screen.queryByRole("button", { name: "Disable" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use system" }));
  await waitFor(() =>
    expect(api.configure).toHaveBeenCalledWith(
      "stt",
      expect.objectContaining({
        provider: "system",
        endpoint: "",
        model: "system",
        voice: null,
        language: "zh-CN",
      }),
    ),
  );
  expect(screen.getByRole("combobox", { name: "Service" })).toHaveTextContent(
    "System",
  );
  expect(screen.getByRole("tab", { name: /Listen/ })).toHaveTextContent(
    "System",
  );
  expect(
    screen.queryByRole("button", { name: "Use system" }),
  ).not.toBeInTheDocument();
});
