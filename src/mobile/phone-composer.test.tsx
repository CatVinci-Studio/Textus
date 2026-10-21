// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An iPhone at phone width: the composer takes its phone form.
vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isIOSApp: true,
}));
vi.mock("../ai/provider-catalog", () => ({
  useActiveProvider: () => ({ supportsVision: true }),
  useWebSearchStatus: () => null,
}));
vi.mock("../ai/chat/deep-thinking", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCanThinkDeeper: () => false,
}));
vi.mock("../platform/ipc", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ai: {
    listSkills: vi.fn().mockResolvedValue(null),
    loadAgentWorkspace: vi.fn().mockResolvedValue({
      skills: [{ name: "polish", description: "Tighten", prompt: "Polish" }],
    }),
  },
}));
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { ChatComposer } = await import("../ai/chat/ChatComposer");
const { pressKeepingFocus, tapKeepingFocus } = await import("../ui/tap");

const labels = {
  dropSelection: "Remove selection",
  showSelection: "Show in document",
  atCursor: "At the cursor",
  placeholder: "Ask anything",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  selectedChars: (n: number) => `${n} chars selected`,
  selectedPicture: "Picture selected",
  attachmentTruncated: "(shortened)",
  attachmentNoVision: "No images",
  modeWrite: "Write",
  modeReview: "Review",
  modeRevise: "Revise",
  modeLabel: "Mode",
  webSearch: "Web search",
  deepThinking: "Deep thinking",
  deepThinkingHint:
    "Deep thinking: when it's on, Textus AI thinks longer before it answers",
  toggleOnHint: "{label} (On - click again to turn it off)",
  webSearchNeedsService: "Choose a search service",
};

function renderComposer(
  props: Partial<React.ComponentProps<typeof ChatComposer>> = {},
) {
  const onSend = vi.fn();
  render(
    <ChatComposer
      docPath={null}
      workspaceRoot={null}
      selectedText={null}
      busy={false}
      labels={labels}
      defaultMode="revise"
      defaultWebSearch={false}
      onSend={onSend}
      onStop={() => {}}
      onEscape={() => {}}
      {...props}
    />,
  );
  return { onSend };
}

describe("the composer on a phone", () => {
  it("picks the mode with a segmented control, and sends with it", () => {
    const { onSend } = renderComposer();
    const modes = screen.getByRole("radiogroup", { name: "Mode" });
    expect(
      [...modes.querySelectorAll('[role="radio"]')].map((m) => m.textContent),
    ).toEqual(["Write", "Review", "Revise"]);
    expect(screen.getByRole("radio", { name: "Revise" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Review" }));
    expect(screen.getByRole("radio", { name: "Review" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "why?" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("why?", [], true, {
      mode: "review",
      webSearch: false,
      thinking: "auto",
    });
  });

  it("docked, quotes the selection and falls back to the cursor", () => {
    renderComposer({
      selectedText: "the passage",
      dockActions: <button>Close</button>,
    });
    // The quote replaces the toolbar's character count.
    expect(screen.getByText("the passage")).toBeInTheDocument();
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove selection"));
    expect(screen.getByText("At the cursor")).toBeInTheDocument();
  });

  it("picks a / skill with a tap", async () => {
    renderComposer();
    const input = screen.getByPlaceholderText("Ask anything");
    fireEvent.change(input, { target: { value: "/po" } });
    const row = await screen.findByText("/polish");
    const item = row.closest("button")!;
    fireEvent.touchStart(item, { touches: [{ clientX: 5, clientY: 5 }] });
    fireEvent.touchEnd(item, { changedTouches: [{ clientX: 6, clientY: 7 }] });
    expect(input).toHaveValue("/polish ");
  });
});

describe("tapKeepingFocus", () => {
  function touch(moveTo: number) {
    const action = vi.fn();
    render(<button {...tapKeepingFocus(action)}>row</button>);
    const button = screen.getByText("row");
    fireEvent.touchStart(button, { touches: [{ clientX: 0, clientY: 0 }] });
    const ended = fireEvent.touchEnd(button, {
      changedTouches: [{ clientX: 0, clientY: moveTo }],
    });
    return { action, cancelled: !ended };
  }

  it("runs on a tap and cancels the mouse events that would follow", () => {
    const { action, cancelled } = touch(4);
    expect(action).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  it("leaves a touch that scrolled the list alone", () => {
    const { action, cancelled } = touch(40);
    expect(action).not.toHaveBeenCalled();
    expect(cancelled).toBe(false);
  });

  it("runs on a mouse press without taking focus", () => {
    const action = vi.fn();
    render(<button {...tapKeepingFocus(action)}>row</button>);
    expect(fireEvent.mouseDown(screen.getByText("row"))).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("pressKeepingFocus", () => {
  function touch(moveTo: number) {
    const action = vi.fn();
    render(<button {...pressKeepingFocus(action)}>Delete table</button>);
    const button = screen.getByText("Delete table");
    fireEvent.touchStart(button, { touches: [{ clientX: 0, clientY: 0 }] });
    const ended = fireEvent.touchEnd(button, {
      changedTouches: [{ clientX: moveTo, clientY: 0 }],
    });
    return { action, cancelled: !ended };
  }

  it("runs on a tap", () => {
    const { action, cancelled } = touch(4);
    expect(action).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  // The keyboard toolbar scrolls sideways under its delete buttons.
  it("does not run when the finger swiped along the strip", () => {
    const { action, cancelled } = touch(60);
    expect(action).not.toHaveBeenCalled();
    // Nor is a click left for WebKit to synthesise.
    expect(cancelled).toBe(true);
  });

  it("runs on a click and keeps focus on pointerdown", () => {
    const action = vi.fn();
    render(<button {...pressKeepingFocus(action)}>Undo</button>);
    const button = screen.getByText("Undo");
    expect(fireEvent.pointerDown(button)).toBe(false);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
