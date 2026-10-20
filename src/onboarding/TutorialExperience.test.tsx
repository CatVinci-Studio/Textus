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
import { GRAMMAR_WAIT_MS, TutorialExperience } from "./TutorialExperience";
import { practiceNotes } from "./practice-notes";
import { GRAMMAR_PART } from "./tutorial-evaluation";
import { useTutorial, type Tutorial } from "./useTutorial";

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
    settings: {
      textusAi: true,
      aiProvider: "openai",
      themeId: "default",
      userThemes: [],
    },
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
  onTutorial,
}: {
  language?: Lang;
  phone?: boolean;
  /** Hands the tour's state out, to act as the app would. */
  onTutorial?: (tutorial: Tutorial) => void;
}) {
  const tutorial = useTutorial();
  onTutorial?.(tutorial);
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
      screen.getByRole("button", { name: /Provider OpenAI/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with OpenAI" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    const write = screen.getByRole("dialog", { name: t.tutorialWriteTitle });
    expect(write).toHaveTextContent(
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
    const write = screen.getByRole("dialog", { name: t.tutorialWriteTitle });
    expect(write).not.toHaveTextContent("Connect an AI later");
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
  it("keeps the lines to follow, Continue as the way on, the animation as an extra", () => {
    resumeAt("revision", { aiMode: "watch" });
    render(<Harness language="zh" />);
    const zh = resolveStrings("zh");
    expect(screen.getByText("改得更简洁")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /观看动画/ }));
    expect(links.openTutorialsPage).toHaveBeenCalledWith("zh", "revision");
    const next = screen.getByRole("button", { name: zh.tutorialNext });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(
      screen.getByRole("dialog", { name: zh.tutorialGrammarTitle }),
    ).toBeInTheDocument();
  });
});

describe("the lessons' copy", () => {
  it("fills in the notes' title and slip, and the shortcuts", () => {
    resumeAt("wysiwyg");
    const first = render(<Harness language="zh" />);
    expect(screen.getByText(`# ${practiceNotes("zh").title}`)).toBeVisible();
    first.unmount();
    resumeAt("grammar", { aiMode: "live" });
    const second = render(<Harness />);
    expect(screen.getByText(practiceNotes("en").slip).tagName).toBe("CODE");
    second.unmount();
    resumeAt("write", { aiMode: "live" });
    render(<Harness />);
    expect(
      screen.getByText(
        "Open the AI panel: the speech bubble icon at the top right (Ctrl+Shift+L)",
      ),
    ).toBeVisible();
  });

  it("finds the sidebar through the menu, and its shortcut", () => {
    resumeAt("sidebar-export");
    render(<Harness />);
    expect(
      screen.getByText(
        "Click the menu ☰ at the top left, choose View › Sidebar (Ctrl+\\), then open Outline",
      ),
    ).toBeVisible();
  });

  it("speaks of taps on a phone", () => {
    resumeAt("continuation", { aiMode: "live" });
    const { unmount } = render(<Harness phone />);
    expect(screen.getByText(/pause, then tap the gray text/)).toBeVisible();
    unmount();
    resumeAt("write", { aiMode: "live" });
    render(<Harness phone />);
    expect(screen.getByText(t.tutorialWriteOpenPhone)).toBeVisible();
  });

  it("ends with the video tutorials, the community and the Memory tab", () => {
    resumeAt("done");
    render(<Harness language="ko" />);
    const ko = resolveStrings("ko");
    expect(screen.getByText(ko.tutorialDoneMemory)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: ko.menuHelpTutorials }));
    fireEvent.click(screen.getByRole("button", { name: ko.menuHelpCommunity }));
    expect(links.openTutorialsPage).toHaveBeenCalledWith("ko");
    expect(links.openCommunityPage).toHaveBeenCalledWith("ko");
  });

  it("never locks the optional formulas and diagrams", () => {
    resumeAt("blocks");
    render(<Harness />);
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: t.tutorialSkipStep }),
    ).not.toBeInTheDocument();
  });
});

describe("the grammar lesson, live", () => {
  it("waits for the sentence, then gives the AI a while before letting the learner on", () => {
    vi.useFakeTimers();
    let tutorial: Tutorial | null = null;
    resumeAt("grammar", { aiMode: "live" });
    render(<Harness onTutorial={(tour) => (tutorial = tour)} />);
    act(() => vi.advanceTimersByTime(GRAMMAR_WAIT_MS + 500));
    // Nothing typed yet: nothing to wait for.
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeDisabled();
    act(() => tutorial!.setPhase(GRAMMAR_PART.typed));
    act(() => vi.advanceTimersByTime(GRAMMAR_WAIT_MS));
    expect(screen.getByText(t.tutorialGrammarQuiet)).toBeVisible();
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeEnabled();
  });

  it("goes on as soon as the card is opened", () => {
    vi.useFakeTimers();
    let tutorial: Tutorial | null = null;
    resumeAt("grammar", { aiMode: "live" });
    render(<Harness onTutorial={(tour) => (tutorial = tour)} />);
    act(() => tutorial!.setPhase(GRAMMAR_PART.typed | GRAMMAR_PART.card));
    expect(screen.getByRole("button", { name: t.tutorialNext })).toBeEnabled();
    act(() => vi.advanceTimersByTime(GRAMMAR_WAIT_MS));
    expect(screen.queryByText(t.tutorialGrammarQuiet)).not.toBeInTheDocument();
  });
});
