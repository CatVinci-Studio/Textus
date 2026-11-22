// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderCatalogEntry } from "./provider-catalog";

let signedIn = false;
vi.mock("../platform/ipc", () => ({
  auth: {
    oauthStatus: async () => ({ configured: signedIn }),
    providerApiKeyStatus: async () => false,
    customEndpointsStatus: async () => [],
  },
}));

const { useConnectedProviders } = await import("./provider-connection");

const openai = {
  id: "openai",
  auth: ["oauth", "api_key"],
} as unknown as ProviderCatalogEntry;
const catalog = [openai];

describe("a provider's connection", () => {
  it("is one copy: a sign-in checked in Settings shows in the AI panel at once", async () => {
    const settings = renderHook(() => useConnectedProviders(catalog, "openai"));
    const panel = renderHook(() => useConnectedProviders(catalog, "openai"));
    await waitFor(() =>
      expect(panel.result.current.connected.openai).toBeDefined(),
    );
    expect(panel.result.current.isConnected).toBe(false);
    signedIn = true;
    act(() => settings.result.current.refreshConnected(openai));
    await waitFor(() => expect(panel.result.current.isConnected).toBe(true));
  });
});
