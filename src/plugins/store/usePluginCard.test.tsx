// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { showPluginCard, type CardRequest } from "./plugin-card";
import { useMutedCards, usePluginCard } from "./usePluginCard";

const request: CardRequest = {
  plugin: "pdf",
  reason: "a.pdf",
  situation: { type: "open", path: "/a.pdf" },
  installed: false,
};

it("follows the card shown, answers it, and counts what was put away", async () => {
  const card = renderHook(() => usePluginCard());
  const muted = renderHook(() => useMutedCards());
  expect(card.result.current).toBeNull();
  let shown!: Promise<unknown>;
  act(() => {
    shown = showPluginCard(request);
  });
  expect(card.result.current?.request).toBe(request);
  act(() => card.result.current?.answer("never"));
  expect(await shown).toBe("never");
  expect(card.result.current).toBeNull();
  expect(muted.result.current.count).toBe(1);
  act(() => muted.result.current.restore());
  expect(muted.result.current.count).toBe(0);
});
