// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { ai, auth } from "../../platform/ipc";
import { ImageModelSection } from "./image-model";

const fresh = () => ({
  aiProvider: "openai",
  imageModelProvider: "chat",
  imageModel: "",
  imageModelEndpoint: "",
});

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  setSettings: vi.fn(),
}));

vi.mock("../../prefs/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../prefs/SettingsContext")>()),
  useSettings: () => ({
    settings: state.settings,
    setSettings: state.setSettings,
  }),
}));

const t = resolveStrings("en");

function catalog() {
  vi.spyOn(ai, "listImageProviders").mockResolvedValue([
    {
      id: "openai-chatgpt",
      label: "OpenAI (ChatGPT sign-in)",
      api: "chat-gpt",
      baseUrl: null,
      keyId: "",
      models: ["gpt-image"],
    },
    {
      id: "openai",
      label: "OpenAI",
      api: "open-ai",
      baseUrl: "https://api.openai.com/v1",
      keyId: "openai",
      models: ["gpt-image-2", "gpt-image-1-mini"],
    },
    {
      id: "custom",
      label: "OpenAI-compatible endpoint",
      api: "compatible",
      baseUrl: null,
      keyId: "__image_model_custom",
      models: [],
    },
  ]);
}

function signedIn(configured: boolean) {
  vi.spyOn(auth, "oauthStatus").mockResolvedValue({ configured });
}

const service = () =>
  screen.getByRole("combobox", { name: t.imageServiceLabel });

beforeEach(() => {
  state.settings = fresh();
  vi.spyOn(auth, "providerApiKeyStatus").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.setSettings.mockReset();
});

describe("ImageModelSection", () => {
  it("follows the chat provider by default, with that service's models", async () => {
    catalog();
    signedIn(false);
    render(<ImageModelSection t={t} />);
    await waitFor(() =>
      expect(service()).toHaveTextContent("Same as chat (OpenAI)"),
    );
    expect(
      screen.getByRole("combobox", { name: t.imageModelLabel }),
    ).toHaveTextContent("gpt-image-2");
  });

  it("with a ChatGPT sign-in, follows it to the plan's own pictures, no key asked", async () => {
    catalog();
    signedIn(true);
    const keys = vi.spyOn(auth, "providerApiKeyStatus");
    render(<ImageModelSection t={t} />);
    await waitFor(() =>
      expect(service()).toHaveTextContent(
        `Same as chat (${t.imageProviderChatGpt})`,
      ),
    );
    // One model: no second select. No key: none asked for.
    expect(
      screen.queryByRole("combobox", { name: t.imageModelLabel }),
    ).toBeNull();
    expect(keys).not.toHaveBeenCalled();
  });

  it("says so when the chat provider makes no pictures", async () => {
    catalog();
    signedIn(false);
    state.settings.aiProvider = "deepseek";
    render(<ImageModelSection t={t} />);
    expect(
      await screen.findByText(t.imageServiceFollowNoPictures),
    ).toBeInTheDocument();
    expect(service()).toHaveTextContent(t.imageServiceFollowChatBare);
  });

  it("the service, then its model, each a select of its own", async () => {
    catalog();
    signedIn(false);
    state.settings.imageModelProvider = "";
    render(<ImageModelSection t={t} />);
    expect(service()).toHaveTextContent(t.imageModelNone);
    await waitFor(() => expect(ai.listImageProviders).toHaveBeenCalled());
    fireEvent.click(service());
    fireEvent.click(await screen.findByRole("option", { name: "OpenAI" }));
    expect(state.setSettings).toHaveBeenCalledWith({
      imageModelProvider: "openai",
      imageModel: "",
    });
    cleanup();
    state.settings.imageModelProvider = "openai";
    render(<ImageModelSection t={t} />);
    const model = await screen.findByRole("combobox", {
      name: t.imageModelLabel,
    });
    fireEvent.click(model);
    fireEvent.click(
      await screen.findByRole("option", { name: "gpt-image-1-mini" }),
    );
    expect(state.setSettings).toHaveBeenLastCalledWith({
      imageModel: "gpt-image-1-mini",
    });
  });

  it("the ChatGPT sign-in, chosen without one, asks for it", async () => {
    catalog();
    signedIn(false);
    state.settings.imageModelProvider = "openai-chatgpt";
    render(<ImageModelSection t={t} />);
    expect(
      await screen.findByText(t.imageChatGptSignInHint),
    ).toBeInTheDocument();
  });

  it("asks for a key only when the service has none from chat", async () => {
    catalog();
    signedIn(false);
    state.settings.imageModelProvider = "openai";
    const status = vi
      .spyOn(auth, "providerApiKeyStatus")
      .mockResolvedValue(true);
    const { unmount } = render(<ImageModelSection t={t} />);
    await waitFor(() => expect(status).toHaveBeenCalledWith("openai"));
    expect(screen.queryByPlaceholderText(t.apiKeyPlaceholder)).toBeNull();
    unmount();

    status.mockResolvedValue(false);
    render(<ImageModelSection t={t} />);
    expect(
      await screen.findByPlaceholderText(t.apiKeyPlaceholder),
    ).toBeInTheDocument();
  });

  it("takes an address and a model name for a compatible endpoint", async () => {
    catalog();
    signedIn(false);
    state.settings.imageModelProvider = "custom";
    vi.spyOn(auth, "providerApiKeyStatus").mockResolvedValue(false);
    render(<ImageModelSection t={t} />);
    fireEvent.change(await screen.findByLabelText(t.imageModelEndpointLabel), {
      target: { value: "http://localhost:7860/v1" },
    });
    expect(state.setSettings).toHaveBeenCalledWith({
      imageModelEndpoint: "http://localhost:7860/v1",
    });
    expect(screen.getByLabelText(t.imageModelNameLabel)).toBeInTheDocument();
  });
});
