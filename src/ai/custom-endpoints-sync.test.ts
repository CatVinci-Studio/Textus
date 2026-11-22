// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const handlers = vi.hoisted(
  () => ({}) as Record<string, (event: { payload: unknown }) => void>,
);
const saved = vi.hoisted(() => ({
  list: [
    {
      id: "custom:b1",
      name: "Relay B",
      base_url: "https://b.example/v1",
      has_api_key: true,
      model: "m",
    },
  ],
}));
vi.mock("../platform/ipc", () => ({
  auth: { customEndpointsStatus: () => Promise.resolve(saved.list) },
}));
vi.mock("../platform/events", () => ({
  listenToThisWindow: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  },
}));

import { useCustomEndpoints } from "./custom-endpoints";

describe("custom endpoints across windows", () => {
  it("read anew when another window renames one", async () => {
    const { result } = renderHook(() => useCustomEndpoints());
    await waitFor(() => expect(result.current[0]?.name).toBe("Relay B"));
    // Renamed elsewhere: the same ids, so nothing else would ask again.
    saved.list = [{ ...saved.list[0]!, name: "Office relay" }];
    act(() => handlers["custom-endpoints-changed"]?.({ payload: null }));
    await waitFor(() => expect(result.current[0]?.name).toBe("Office relay"));
  });
});
