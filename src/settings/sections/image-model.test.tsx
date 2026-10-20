// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { ai, auth } from "../../platform/ipc";
import { ImageModelSection } from "./image-model";

const state = vi.hoisted(() => ({
  settings: { imageModelProvider: "", imageModel: "", imageModelEndpoint: "" },
  setSettings: vi.fn(),
}));

vi.mock("../SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../SettingsContext")>()),
  useSettings: () => ({
    settings: state.settings,
    setSettings: state.setSettings,
  }),
}));

const t = resolveStrings("en");

function catalog() {
  vi.spyOn(ai, "listImageProviders").mockResolvedValue([
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.setSettings.mockReset();
  state.settings = {
    imageModelProvider: "",
    imageModel: "",
    imageModelEndpoint: "",
  };
});

describe("ImageModelSection", () => {
  it("is None by default and offers each service's models", async () => {
    catalog();
    render(<ImageModelSection t={t} />);
    const select = screen.getByRole("combobox", { name: t.imageModelLabel });
    expect(select).toHaveTextContent(t.imageModelNone);
    await waitFor(() => expect(ai.listImageProviders).toHaveBeenCalled());
    fireEvent.click(select);
    fireEvent.click(
      await screen.findByRole("option", { name: "OpenAI · gpt-image-1-mini" }),
    );
    expect(state.setSettings).toHaveBeenCalledWith({
      imageModelProvider: "openai",
      imageModel: "gpt-image-1-mini",
    });
  });

  it("asks for a key only when the service has none from chat", async () => {
    catalog();
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
