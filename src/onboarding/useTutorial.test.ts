// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTutorial } from "./useTutorial";
import { stepIndexOf, type TutorialStepId } from "./tutorial-steps";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { sendTourSignal } from "../utils/events";

const KEY = "levis-tutorial-progress";
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

function resumeAt(stepId: TutorialStepId, extra: object = {}) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ active: true, stepId, tabId: "practice", ...extra }),
  );
  return renderHook(() => useTutorial()).result;
}

/** Steps forward until `id` is the current step. */
function goTo(result: { current: ReturnType<typeof useTutorial> }, id: string) {
  while (result.current.step.id !== id) act(() => result.current.next());
}

beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());

describe("useTutorial navigation", () => {
  it("keeps a lesson complete when the learner moves back and forth", () => {
    const { result } = renderHook(() => useTutorial());
    act(() => result.current.start("practice-tab"));
    goTo(result, "wysiwyg");
    act(() => result.current.setPhase(3));
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.step.id).toBe("wysiwyg");
    expect(result.current.phase).toBe(3);
  });

  it("saves the step's id beside its index", () => {
    const { result } = renderHook(() => useTutorial());
    act(() => result.current.start("practice"));
    act(() => result.current.next());
    expect(saved()).toMatchObject({
      active: true,
      stepIndex: 1,
      stepId: "wysiwyg",
      tabId: "practice",
      aiMode: null,
    });
  });

  it.each([2.5, -1, 999, "invalid", null])(
    "normalizes persisted step %s",
    (stepIndex) => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ active: true, stepIndex, tabId: "practice" }),
      );
      const { result } = renderHook(() => useTutorial());
      expect(result.current.step).toBeDefined();
      expect(Number.isInteger(result.current.stepIndex)).toBe(true);
    },
  );

  it("ignores delayed navigation after exit", () => {
    const { result } = renderHook(() => useTutorial());
    act(() => result.current.start("practice"));
    act(() => result.current.exit());
    act(() => {
      result.current.next();
      result.current.back();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.stepIndex).toBe(0);
  });
});

describe("the AI mode", () => {
  it("is live when the connect lesson is left connected", () => {
    const result = resumeAt("connect");
    act(() => result.current.setPhase(1));
    act(() => result.current.next());
    expect(result.current.step.id).toBe("ai-panel");
    expect(result.current.aiMode).toBe("live");
    expect(result.current.watching).toBe(false);
    expect(result.current.practiceAi).toBe("live");
    expect(saved()).toMatchObject({ stepId: "ai-panel", aiMode: "live" });
  });

  it("is watch when the connect lesson is skipped", () => {
    const result = resumeAt("connect");
    act(() => result.current.next());
    expect(result.current.aiMode).toBe("watch");
    expect(result.current.watching).toBe(true);
    expect(result.current.practiceAi).toBe("muted");
    expect(saved()).toMatchObject({ aiMode: "watch" });
  });

  it("is decided again when the learner goes back to connect", () => {
    const result = resumeAt("ai-panel", { aiMode: "watch" });
    act(() => result.current.back());
    expect(result.current.step.id).toBe("connect");
    act(() => result.current.setPhase(1));
    act(() => result.current.next());
    expect(result.current.aiMode).toBe("live");
  });

  it("survives a relaunch with the step", () => {
    const live = resumeAt("revision", { aiMode: "live" });
    expect(live.current.step.id).toBe("revision");
    expect(live.current.practiceAi).toBe("live");
    const watched = resumeAt("revision", { aiMode: "watch" });
    expect(watched.current.watching).toBe(true);
  });

  it("keeps the practice tab's AI muted through the writing lessons", () => {
    const result = resumeAt("blocks", { aiMode: "live" });
    expect(result.current.practiceAi).toBe("muted");
    expect(result.current.watching).toBe(false);
  });

  it("starts over with no mode", () => {
    const result = resumeAt("memory", { aiMode: "live" });
    act(() => result.current.start("practice"));
    expect(result.current.aiMode).toBeNull();
    expect(result.current.stepIndex).toBe(0);
  });
});

describe("the AI lessons' signals", () => {
  it.each([
    ["continuation", "completion-accepted"],
    ["grammar", "grammar-card"],
    ["revision", "revision-decided"],
    ["review", "review-note"],
    ["review", "reply"],
    ["skills", "skill-sent"],
  ] as const)("complete %s on %s", (stepId, signal) => {
    const result = resumeAt(stepId, { aiMode: "live" });
    expect(result.current.phase).toBe(0);
    act(() => sendTourSignal(signal));
    expect(result.current.phase).toBe(1);
  });

  it("only complete the lesson they belong to", () => {
    const result = resumeAt("revision", { aiMode: "live" });
    act(() => sendTourSignal("completion-accepted"));
    act(() => sendTourSignal("skill-sent"));
    expect(result.current.phase).toBe(0);
    expect(stepIndexOf("revision")).toBe(result.current.stepIndex);
  });
});
