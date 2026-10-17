// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTutorial } from "./useTutorial";
import { installTestLocalStorage } from "../dev/test-local-storage";

describe("useTutorial navigation", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("keeps a lesson complete when the learner moves back and forth", () => {
    const { result } = renderHook(() => useTutorial());

    act(() => result.current.start("practice-tab"));
    act(() => result.current.next()); // Markdown chapter transition
    act(() => result.current.next()); // Markdown exercise
    act(() => result.current.setPhase(127));
    expect(result.current.step.id).toBe("markdownPractice");
    expect(result.current.phase).toBe(127);

    act(() => result.current.next()); // AI chapter transition
    act(() => result.current.back());
    expect(result.current.step.id).toBe("markdownPractice");
    expect(result.current.phase).toBe(127);
  });
  it.each([2.5, -1, 999, "invalid", null])(
    "normalizes persisted step %s",
    (stepIndex) => {
      localStorage.setItem(
        "levis-tutorial-progress",
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
