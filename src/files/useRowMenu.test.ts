// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import { useRowMenu } from "./useRowMenu";

describe("a tree row's menu", () => {
  it("is named for the row, heading a phone's sheet", () => {
    const noop = () => {};
    const { result } = renderHook(() =>
      useRowMenu("/proj", "/proj", en, noop, noop, noop, noop, null),
    );
    act(() => result.current.openRowMenu({ x: 0, y: 0 }, "/proj/a.md", false));
    expect(result.current.menu?.title).toBe("a.md");
  });
});
