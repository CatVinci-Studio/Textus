// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { installTestLocalStorage } from "../../../dev/test-local-storage";
import { frameLayout, setFrameLayout } from "../../../engine/frame/frame-store";
import { useAgentPanelState } from "./agent-panel";

beforeAll(installTestLocalStorage);

describe("the docked AI panel's width", () => {
  it("leaves the islands beside it what they need, as the sidebar does", () => {
    const panel = renderHook(() => useAgentPanelState(1200, 0));
    const roomy = panel.result.current.max;
    act(() => setFrameLayout({ ...frameLayout(), need: 900 }));
    expect(panel.result.current.max).toBeLessThan(roomy);
    expect(panel.result.current.max).toBeLessThanOrEqual(1200 - 900);
    act(() => setFrameLayout({ ...frameLayout(), need: 0 }));
  });
});
