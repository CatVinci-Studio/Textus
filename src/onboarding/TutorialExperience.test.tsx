// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import { emitPluginEvent } from "../plugins/app-bridge";
import { TutorialExperience } from "./TutorialExperience";
import { useTutorial, type Tutorial } from "./useTutorial";

const ai = vi.hoisted(() => ({ on: true, signedIn: false as boolean | null }));

vi.mock("../prefs/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../prefs/SettingsContext")>()),
  useSettings: () => ({ settings: { textusAi: ai.on }, setSettings: vi.fn() }),
}));
vi.mock("../ai/chat/chat-models", () => ({
  useAiSignedIn: () => ai.signedIn,
}));
vi.mock("../platform/ipc", () => ({
  links: {
    openTutorialsPage: vi.fn().mockResolvedValue(undefined),
    openCommunityPage: vi.fn().mockResolvedValue(undefined),
  },
}));

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

const t = resolveStrings("en");
let tour: Tutorial;
const keep = (current: Tutorial) => (tour = current);

function Harness({
  phone = false,
  onTutorial = keep,
}: {
  phone?: boolean;
  onTutorial?: (tutorial: Tutorial) => void;
}) {
  const tour = useTutorial(ai.on);
  onTutorial(tour);
  return tour.active ? (
    <TutorialExperience tutorial={tour} t={t} language="en" phone={phone} />
  ) : null;
}

function resumeAt(stepId: string) {
  localStorage.setItem(
    "textus-tutorial-progress",
    JSON.stringify({ active: true, stepId, tabId: "practice" }),
  );
  render(<Harness />);
}

const card = () => screen.getByRole("dialog");
const panels = (sidebar: boolean, aiOpen: boolean) =>
  act(() =>
    emitPluginEvent("panels", {
      sidebar: { open: sidebar, tab: "tree" },
      ai: { open: aiOpen },
    }),
  );

beforeAll(installTestLocalStorage);
beforeEach(() => {
  localStorage.clear();
  ai.on = true;
  ai.signedIn = false;
});
afterEach(cleanup);

describe("the tour's card", () => {
  it("starts, then waits for the sidebar to open", () => {
    resumeAt("welcome");
    expect(card()).toHaveAccessibleName(t.tutorialWelcomeTitle);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialStart }));
    expect(card()).toHaveAccessibleName(t.tutorialSidebarTitle);
    expect(
      screen.queryByRole("button", { name: t.tutorialNext }),
    ).not.toBeInTheDocument();
    panels(true, false);
    expect(card()).toHaveAccessibleName(t.tutorialRailTitle);
  });

  it("walks the sidebar's buttons one by one", () => {
    resumeAt("rail");
    expect(card()).toHaveTextContent(t.tutorialRailFiles);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    expect(card()).toHaveTextContent(t.tutorialRailOutline);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    expect(card()).toHaveTextContent(t.tutorialRailPlugins);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    // Last, that the icon bar hides from its right-click.
    expect(card()).toHaveTextContent(t.tutorialRailHide);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialNext }));
    expect(card()).toHaveAccessibleName(t.tutorialSettingsTitle);
  });

  it("asks to sign in once the AI opens, and skipping it ends the tour", () => {
    resumeAt("ai");
    panels(false, true);
    expect(card()).toHaveAccessibleName(t.tutorialSignInTitle);
    fireEvent.click(
      screen.getByRole("button", { name: t.tutorialConnectSkip }),
    );
    expect(card()).toHaveAccessibleName(t.tutorialDoneTitle);
  });

  it("goes on to use the AI once signed in", () => {
    resumeAt("signin");
    ai.signedIn = true;
    fireEvent.click(screen.getByRole("button", { name: t.tutorialBack }));
    panels(false, true);
    expect(card()).toHaveAccessibleName(t.tutorialAiUseTitle);
  });

  it("ends with the tutorials and the community, and Esc leaves", () => {
    resumeAt("done");
    expect(
      screen.getByRole("button", { name: t.menuHelpTutorials }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.tutorialFinish }));
    expect(tour.active).toBe(false);
    cleanup();
    resumeAt("editor");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tour.active).toBe(false);
  });
});
