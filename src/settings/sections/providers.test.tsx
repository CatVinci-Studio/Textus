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
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { auth, type CustomEndpointConfig } from "../../platform/ipc";
import {
  CustomProviderPanel,
  ProviderAuthPanel,
  ProviderListPanel,
} from "./providers";

const settingsMocks = vi.hoisted(() => ({ setSettings: vi.fn() }));
const providerMocks = vi.hoisted(() => ({
  catalog: [
    {
      id: "google",
      label: "Google Gemini",
      dialect: "openai-chat-completions",
      auth: ["api_key"],
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-3.1-flash-lite",
      agentDefaultModel: "gemini-3.5-flash",
      keyOptional: false,
      oauthUnofficial: false,
      modelsListable: true,
      knownModels: ["gemini-3.5-flash"],
    },
    {
      id: "doubao",
      label: "Doubao (Volcengine)",
      dialect: "openai-chat-completions",
      auth: ["api_key"],
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      defaultModel: "doubao-seed-2-1-turbo-260628",
      agentDefaultModel: "doubao-seed-2-1-pro-260628",
      keyOptional: false,
      oauthUnofficial: false,
      modelsListable: true,
      knownModels: ["doubao-seed-2-1-pro-260628"],
    },
  ],
}));

vi.mock("../../prefs/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../prefs/SettingsContext")>()),
  useSettings: () => ({
    settings: { aiProvider: "google" },
    setSettings: settingsMocks.setSettings,
  }),
}));

vi.mock("../../ai/provider-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../ai/provider-catalog")>();
  return { ...actual, useProviderCatalog: () => providerMocks.catalog };
});

vi.mock("../../platform/ipc", () => ({
  auth: {
    providerApiKeyStatus: vi.fn().mockResolvedValue(false),
    setProviderApiKey: vi.fn().mockResolvedValue(undefined),
    clearProviderApiKey: vi.fn().mockResolvedValue(undefined),
    oauthStatus: vi.fn().mockResolvedValue({ configured: false }),
    oauthLogin: vi.fn(),
    oauthLogout: vi.fn(),
    customEndpointStatus: vi.fn().mockResolvedValue(null),
    setCustomEndpoint: vi.fn().mockResolvedValue(undefined),
    clearCustomEndpoint: vi.fn().mockResolvedValue(undefined),
    fetchCustomModels: vi.fn().mockResolvedValue([]),
    testCustomEndpoint: vi.fn().mockResolvedValue(undefined),
  },
}));

const google = providerMocks.catalog[0] as ProviderCatalogEntry;

afterEach(cleanup);

describe("ProviderAuthPanel", () => {
  it("shows the API key form for providers that do not offer account login", () => {
    render(
      <ProviderAuthPanel
        t={resolveStrings("en")}
        entry={google}
        onStatusChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("sk-…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps credentials collapsed behind a second compact disclosure row", () => {
    render(<ProviderListPanel t={resolveStrings("en")} />);

    expect(
      screen.getByRole("button", { name: /Provider Google Gemini/i }),
    ).toBeInTheDocument();
    const credentials = screen.getByRole("button", {
      name: /Login & credentials Not configured/i,
    });
    expect(screen.queryByPlaceholderText("sk-…")).not.toBeInTheDocument();

    fireEvent.click(credentials);
    expect(screen.getByPlaceholderText("sk-…")).toBeInTheDocument();
  });
  it("closes the provider list with Escape without closing its parent dialog", () => {
    const parentKey = vi.fn();
    render(
      <div onKeyDown={parentKey}>
        <ProviderListPanel t={resolveStrings("en")} />
      </div>,
    );
    const trigger = screen.getByRole("button", {
      name: /Provider Google Gemini/i,
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(
      screen.getByRole("textbox", {
        name: resolveStrings("en").providerSearchPlaceholder,
      }),
      { key: "Escape" },
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("names Doubao by its Chinese name in Chinese, and finds it by that name", () => {
    render(<ProviderListPanel t={resolveStrings("zh")} />);
    fireEvent.click(screen.getByRole("button", { name: /Google Gemini/ }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: resolveStrings("zh").providerSearchPlaceholder,
      }),
      { target: { value: "豆包" } },
    );
    expect(
      screen.getByRole("button", { name: "豆包（火山引擎）" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Google Gemini" }),
    ).not.toBeInTheDocument();
  });
});

describe("account sign-in", () => {
  const anthropic = {
    ...google,
    id: "anthropic",
    label: "Claude",
    auth: ["oauth"],
  } as ProviderCatalogEntry;

  it("marks an unofficial sign-in experimental, and only that one", () => {
    const t = resolveStrings("en");
    const note = t.signInExperimental;
    const { unmount } = render(
      <ProviderAuthPanel
        t={t}
        entry={{ ...anthropic, oauthUnofficial: true }}
        onStatusChange={() => {}}
      />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();
    unmount();
    render(
      <ProviderAuthPanel t={t} entry={anthropic} onStatusChange={() => {}} />,
    );
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("offers the sign-in link while it waits, for when no browser opens", async () => {
    let finish: (s: { configured: boolean }) => void = () => {};
    vi.mocked(auth.oauthLogin).mockImplementation((_id, onUrl) => {
      onUrl?.("https://claude.example/oauth/authorize?state=abc");
      return new Promise((resolve) => (finish = resolve));
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ProviderAuthPanel
        t={resolveStrings("en")}
        entry={anthropic}
        onStatusChange={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Claude" }),
    );
    expect(
      await screen.findByText(
        "https://claude.example/oauth/authorize?state=abc",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://claude.example/oauth/authorize?state=abc",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    // Signed in (in whichever browser): the link goes away.
    finish({ configured: true });
    await waitFor(() =>
      expect(
        screen.queryByText("https://claude.example/oauth/authorize?state=abc"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("CustomProviderPanel", () => {
  const saved: CustomEndpointConfig = {
    base_url: "https://api.example/v1",
    api_key: null,
    has_api_key: true,
    model: "m1",
  };

  async function renderPanel(status: CustomEndpointConfig | null) {
    vi.mocked(auth.customEndpointStatus).mockResolvedValue(status);
    render(<CustomProviderPanel t={resolveStrings("en")} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(
          resolveStrings("en").customBaseUrlPlaceholder,
        ),
      ).toHaveValue(status?.base_url ?? ""),
    );
    return screen.getByLabelText(resolveStrings("en").customApiKeyLabel);
  }

  it("says a saved key is there instead of showing an empty field", async () => {
    const key = await renderPanel(saved);
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute(
      "placeholder",
      resolveStrings("en").customApiKeySaved,
    );
  });

  it("stops claiming the saved key once the URL names another host", async () => {
    const key = await renderPanel(saved);
    const url = screen.getByPlaceholderText(
      resolveStrings("en").customBaseUrlPlaceholder,
    );
    // A trailing slash is the same endpoint (the backend's rule)...
    fireEvent.change(url, { target: { value: "https://api.example/v1/" } });
    expect(key).toHaveAttribute(
      "placeholder",
      resolveStrings("en").customApiKeySaved,
    );
    // ...another host is not, and won't be sent the old key.
    fireEvent.change(url, { target: { value: "https://other.example/v1" } });
    expect(key).toHaveAttribute(
      "placeholder",
      resolveStrings("en").apiKeyPlaceholder,
    );
  });

  it("shows no saved key for an endpoint saved without one", async () => {
    const key = await renderPanel({ ...saved, has_api_key: false });
    expect(key).toHaveAttribute(
      "placeholder",
      resolveStrings("en").apiKeyPlaceholder,
    );
  });

  it("empties the field after saving a key, and Remove forgets it", async () => {
    const key = await renderPanel(null);
    fireEvent.change(
      screen.getByPlaceholderText(
        resolveStrings("en").customBaseUrlPlaceholder,
      ),
      { target: { value: "https://api.example/v1" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(resolveStrings("en").customModelPlaceholder),
      { target: { value: "m1" } },
    );
    fireEvent.change(key, { target: { value: "sk-new" } });
    fireEvent.click(
      screen.getByRole("button", { name: resolveStrings("en").customSave }),
    );
    await waitFor(() => expect(key).toHaveValue(""));
    expect(auth.setCustomEndpoint).toHaveBeenCalledWith(
      "https://api.example/v1",
      "sk-new",
      "m1",
    );
    expect(key).toHaveAttribute(
      "placeholder",
      resolveStrings("en").customApiKeySaved,
    );

    fireEvent.click(
      screen.getByRole("button", { name: resolveStrings("en").apiKeyClear }),
    );
    await waitFor(() =>
      expect(key).toHaveAttribute(
        "placeholder",
        resolveStrings("en").apiKeyPlaceholder,
      ),
    );
    expect(auth.clearCustomEndpoint).toHaveBeenCalled();
  });
});
