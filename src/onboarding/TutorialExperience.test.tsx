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
import { TourLayer } from "./TourLayer";
import { TutorialExperience } from "./TutorialExperience";
import { useTutorial, type Tutorial } from "./useTutorial";

const ai = vi.hoisted(() => ({ on: true, signedIn: false as boolean | null }));
/** The panels as the window last reported them. */
const shown = vi.hoisted(() => ({
  state: { sidebar: { open: false, tab: "tree" }, ai: { open: false } },
}));
vi.mock("../plugins/panels-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins/panels-state")>()),
  panelsState: () => shown.state,
}));

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
  act(() => {
    shown.state = {
      sidebar: { open: sidebar, tab: "tree" },
      ai: { open: aiOpen },
    };
    emitPluginEvent("panels", shown.state);
  });

beforeAll(installTestLocalStorage);
beforeEach(() => {
  localStorage.clear();
  shown.state = { sidebar: { open: false, tab: "tree" }, ai: { open: false } };
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

  it("goes back past a step already done, instead of bouncing on it", () => {
    resumeAt("rail");
    panels(true, false);
    fireEvent.click(screen.getByRole("button", { name: t.tutorialBack }));
    expect(card()).toHaveAccessibleName(t.tutorialWelcomeTitle);
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
    // An Esc in the text being typed, or one a menu took, stays there.
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    fireEvent.keyDown(editor, { key: "Escape" });
    const taken = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    taken.preventDefault();
    window.dispatchEvent(taken);
    expect(tour.active).toBe(true);
    editor.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tour.active).toBe(false);
  });
});

describe("the tour's dimming", () => {
  it("draws again when a step that left the window undimmed ends", () => {
    const layer = (open: boolean) => (
      <TourLayer
        target={null}
        open={open}
        phone={false}
        labelledBy="x"
        onEscape={() => {}}
      >
        card
      </TourLayer>
    );
    const { container, rerender } = render(layer(true));
    rerender(layer(false));
    expect(
      container.querySelector(".tour-scrim path")?.getAttribute("d"),
    ).toMatch(/^M0 0H/);
  });
});
