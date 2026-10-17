// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resolveStrings } from "../i18n/strings";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { auth } from "../platform/ipc";
import { TutorialExperience } from "./TutorialExperience";
import { TUTORIAL_STEPS } from "./tutorial-steps";
import { useTutorial } from "./useTutorial";

const providerMocks = vi.hoisted(() => ({
  catalog: [
    {
      id: "openai",
      label: "OpenAI",
      dialect: "openai-responses",
      auth: ["oauth", "api_key"],
      baseUrl: null,
      defaultModel: "gpt-6-luna",
      agentDefaultModel: "gpt-6.1-sol",
      keyOptional: false,
      supportsVision: true,
      modelsListable: true,
      knownModels: [],
    },
  ],
}));

vi.mock("../settings/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/SettingsContext")>()),
  useSettings: () => ({
    settings: { aiProvider: "openai" },
    setSettings: vi.fn(),
  }),
}));

vi.mock("../ai/provider-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/provider-catalog")>()),
  useProviderCatalog: () => providerMocks.catalog,
}));

vi.mock("../platform/ipc", () => ({
  auth: {
    providerApiKeyStatus: vi.fn().mockResolvedValue(false),
    setProviderApiKey: vi.fn().mockResolvedValue(undefined),
    clearProviderApiKey: vi.fn().mockResolvedValue(undefined),
    oauthStatus: vi.fn().mockResolvedValue({ configured: false }),
    oauthLogin: vi.fn(),
    oauthLogout: vi.fn(),
    customEndpointStatus: vi.fn().mockResolvedValue(null),
  },
}));

const t = resolveStrings("en");
const shortcuts = { completion: "", grammar: "", agent: "", sidebar: "" };

function Harness() {
  const tutorial = useTutorial();
  return <TutorialExperience tutorial={tutorial} t={t} shortcuts={shortcuts} />;
}

beforeAll(installTestLocalStorage);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "levis-tutorial-progress",
    JSON.stringify({ active: true, stepId: "connectAi", tabId: "practice" }),
  );
});
afterEach(() => {
  cleanup();
  vi.mocked(auth.oauthStatus).mockResolvedValue({ configured: false });
  vi.mocked(auth.providerApiKeyStatus).mockResolvedValue(false);
});

describe("the Connect your AI lesson", () => {
  it("offers Skip for now while nothing is connected, and skips to the end", async () => {
    render(<Harness />);
    expect(
      screen.getByRole("dialog", { name: t.tutorialConnectAiTitle }),
    ).toBeInTheDocument();
    // The Settings controls, credentials already open.
    expect(
      screen.getByRole("button", { name: /Provider: OpenAI/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with OpenAI" }),
    ).toBeInTheDocument();
    expect(screen.getByText(`${t.settingsTitle} › ${t.navAi}`)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(
      screen.getByRole("dialog", { name: t.tutorialDoneTitle }),
    ).toBeInTheDocument();
  });

  it("shows Connected and Continue once the selected provider is signed in", async () => {
    vi.mocked(auth.oauthStatus).mockResolvedValue({ configured: true });
    render(<Harness />);
    expect(await screen.findByText(t.tutorialConnectAiConnected)).toBeVisible();
    expect(
      screen.getByRole("button", { name: new RegExp(t.tutorialNext) }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Skip for now/ }),
    ).not.toBeInTheDocument();
  });

  it("turns Connected on when a key is saved from the lesson", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: t.authTabApiKey }));
    fireEvent.change(screen.getByPlaceholderText(t.apiKeyPlaceholder), {
      target: { value: "sk-test" },
    });
    vi.mocked(auth.providerApiKeyStatus).mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: t.apiKeySave }));
    await waitFor(() =>
      expect(screen.getByText(t.tutorialConnectAiConnected)).toBeVisible(),
    );
    expect(auth.setProviderApiKey).toHaveBeenCalledWith("openai", "sk-test");
  });

  it("is the step right before the ending", () => {
    expect(TUTORIAL_STEPS.at(-2)?.id).toBe("connectAi");
  });
});
