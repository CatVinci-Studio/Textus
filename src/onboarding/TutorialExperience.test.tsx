// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
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
import { resolveStrings, type Lang } from "../i18n/strings";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { auth, links } from "../platform/ipc";
import { TOUR_GRAMMAR_CHECK_EVENT } from "../utils/events";
import { GRAMMAR_WAIT_MS, TutorialExperience } from "./TutorialExperience";
import { practiceDiary } from "./practice-diary";
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
    settings: { aiProvider: "openai", themeId: "default", userThemes: [] },
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
  links: {
    openTutorialsPage: vi.fn().mockResolvedValue(undefined),
    openCommunityPage: vi.fn().mockResolvedValue(undefined),
  },
}));

const t = resolveStrings("en");

function Harness({
  language = "en",
  phone = false,
}: {
  language?: Lang;
  phone?: boolean;
}) {
  const tutorial = useTutorial();
  return (
    <TutorialExperience
      tutorial={tutorial}
      t={resolveStrings(language)}
      language={language}
      phone={phone}
      shortcuts={{ agentPanel: "Ctrl+Shift+L", sidebar: "Ctrl+\\" }}
      zen={{ on: false, toggle: vi.fn() }}
    />
  );
}

function resumeAt(stepId: string, extra: object = {}) {
  localStorage.setItem(
    "levis-tutorial-progress",
    JSON.stringify({ active: true, stepId, tabId: "practice", ...extra }),
  );
}

beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(auth.oauthStatus).mockResolvedValue({ configured: false });
  vi.mocked(auth.providerApiKeyStatus).mockResolvedValue(false);
});

describe("the connect lesson", () => {
  it("offers Skip for now while nothing is connected, then the AI is watched", () => {
    resumeAt("connect");
    render(<Harness />);
    expect(
      screen.getByRole("dialog", { name: t.tutorialConnectTitle }),
    ).toBeInTheDocument();
    // The Settings controls, credentials already open.
    expect(
      screen.getByRole("button", { name: /Provider: OpenAI/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with OpenAI" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    const panel = screen.getByRole("dialog", { name: t.tutorialAiPanelTitle });
    expect(panel).toHaveTextContent(
      "Connect an AI later in Settings › Textus AI to try it yourself.",
    );
  });

  it("shows Connected and Continue once the provider is signed in", async () => {
    vi.mocked(auth.oauthStatus).mockResolvedValue({ configured: true });
    resumeAt("connect");
    render(<Harness />);
    expect(await screen.findByText(t.tutorialConnected)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    // Connected, the AI lessons are done for real: no watch note.
    const panel = screen.getByRole("dialog", { name: t.tutorialAiPanelTitle });
    expect(panel).not.toHaveTextContent("Connect an AI later");
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeDisabled();
  });

  it("turns Connected on when a key is saved from the lesson", async () => {
    resumeAt("connect");
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: t.authTabApiKey }));
    fireEvent.change(screen.getByPlaceholderText(t.apiKeyPlaceholder), {
      target: { value: "sk-test" },
    });
    vi.mocked(auth.providerApiKeyStatus).mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: t.apiKeySave }));
    await waitFor(() =>
      expect(screen.getByText(t.tutorialConnected)).toBeVisible(),
    );
    expect(auth.setProviderApiKey).toHaveBeenCalledWith("openai", "sk-test");
  });
});

describe("watching an AI lesson", () => {
  it("makes the animation the main action, and moving on always possible", () => {
    resumeAt("revision", { aiMode: "watch" });
    render(<Harness language="zh" />);
    const zh = resolveStrings("zh");
    fireEvent.click(screen.getByRole("button", { name: zh.tutorialWatch }));
    expect(links.openTutorialsPage).toHaveBeenCalledWith("zh", "revision");
    const next = screen.getByRole("button", { name: zh.tutorialNext });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(
      screen.getByRole("dialog", { name: zh.tutorialReviewTitle }),
    ).toBeInTheDocument();
  });
});

describe("the lessons' copy", () => {
  it("fills in the diary's title and the shortcuts", () => {
    resumeAt("wysiwyg");
    const { unmount } = render(<Harness language="zh" />);
    expect(screen.getByText(`# ${practiceDiary("zh").title}`)).toBeVisible();
    unmount();
    resumeAt("ai-panel", { aiMode: "live" });
    render(<Harness />);
    expect(
      screen.getByText("Press Ctrl+Shift+L to open the panel."),
    ).toBeVisible();
  });

  it("speaks of taps on a phone", () => {
    resumeAt("continuation", { aiMode: "live" });
    render(<Harness phone />);
    expect(screen.getByText(t.tutorialContinuationTaskPhone)).toBeVisible();
  });

  it("ends with the video tutorials and the community", () => {
    resumeAt("done");
    render(<Harness language="ko" />);
    const ko = resolveStrings("ko");
    fireEvent.click(screen.getByRole("button", { name: ko.menuHelpTutorials }));
    fireEvent.click(screen.getByRole("button", { name: ko.menuHelpCommunity }));
    expect(links.openTutorialsPage).toHaveBeenCalledWith("ko");
    expect(links.openCommunityPage).toHaveBeenCalledWith("ko");
  });
});

describe("the grammar lesson, live", () => {
  it("checks the slip's paragraph, then lets the learner on after a wait", () => {
    vi.useFakeTimers();
    const checked: string[] = [];
    const listener = (e: Event) =>
      checked.push((e as CustomEvent<string>).detail);
    window.addEventListener(TOUR_GRAMMAR_CHECK_EVENT, listener);
    resumeAt("grammar", { aiMode: "live" });
    render(<Harness />);
    act(() => vi.advanceTimersByTime(500));
    expect(checked).toEqual([practiceDiary("en").slip]);
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeDisabled();
    act(() => vi.advanceTimersByTime(GRAMMAR_WAIT_MS));
    expect(screen.getByText(t.tutorialGrammarQuiet)).toBeVisible();
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeEnabled();
    window.removeEventListener(TOUR_GRAMMAR_CHECK_EVENT, listener);
  });

  it("checks nothing while watching", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener(TOUR_GRAMMAR_CHECK_EVENT, listener);
    resumeAt("grammar", { aiMode: "watch" });
    render(<Harness />);
    act(() => vi.advanceTimersByTime(GRAMMAR_WAIT_MS + 500));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(TOUR_GRAMMAR_CHECK_EVENT, listener);
  });
});
