// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTutorial } from "./useTutorial";
import { stepIndexOf, type TutorialStepId } from "./tutorial-steps";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { sendTourSignal } from "../utils/events";

const KEY = "textus-tutorial-progress";
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

function resumeAt(stepId: TutorialStepId) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ active: true, stepId, tabId: "practice" }),
  );
  return renderHook(() => useTutorial()).result;
}

beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());

describe("useTutorial", () => {
  it("saves the step's id beside its index", () => {
    const { result } = renderHook(() => useTutorial());
    act(() => result.current.start("practice"));
    act(() => result.current.next());
    expect(saved()).toMatchObject({
      active: true,
      stepIndex: 1,
      stepId: "sidebar",
      tabId: "practice",
    });
  });

  it("goes back to a step's first stop on every move", () => {
    const result = resumeAt("rail");
    act(() => result.current.setStop(2));
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.step.id).toBe("rail");
    expect(result.current.stop).toBe(0);
  });

  it("jumps to a step by id, and ends past the last", () => {
    const result = resumeAt("signin");
    act(() => result.current.goTo("done"));
    expect(result.current.step.id).toBe("done");
    act(() => result.current.next());
    expect(result.current.active).toBe(false);
  });

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

describe("the practice tab's AI", () => {
  it("is live, in write mode, only on the step that uses it", () => {
    const result = resumeAt("editor");
    expect(result.current.practiceAi).toBe("muted");
    expect(result.current.agentMode).toBe(null);
    act(() => result.current.goTo("ai-use"));
    expect(result.current.practiceAi).toBe("live");
    expect(result.current.agentMode).toBe("write");
  });

  it("stays muted with Textus AI off", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ active: true, stepId: "ai-use", tabId: "practice" }),
    );
    const { result } = renderHook(() => useTutorial(false));
    expect(result.current.practiceAi).toBe("muted");
  });

  it("moves on once the AI's revision is decided, and not before", () => {
    const result = resumeAt("editor");
    act(() => sendTourSignal("revision-decided"));
    expect(result.current.step.id).toBe("editor");
    act(() => result.current.goTo("ai-use"));
    act(() => sendTourSignal("revision-decided"));
    expect(result.current.stepIndex).toBe(stepIndexOf("done"));
  });
});
