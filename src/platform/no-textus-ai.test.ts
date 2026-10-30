// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

// An install where Textus AI isn't offered (an iOS App Store download in
// mainland China), as Rust's boot snapshot says.
async function withoutAi() {
  vi.resetModules();
  (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
    settings: { textusAi: true, enableAskAi: true },
    rev: 1,
    uiState: {},
    aiUnavailable: true,
  };
  return {
    normalise: await import("../settings/settings-normalise"),
    pages: await import("../settings/settings-pages"),
    tour: await import("../onboarding/tutorial-steps"),
    features: await import("../settings/textus-ai"),
  };
}

afterEach(() => {
  delete (window as unknown as { __BOOT__?: unknown }).__BOOT__;
  vi.resetModules();
});

it("keeps the master switch off whatever was saved", async () => {
  const { normalise, features } = await withoutAi();
  for (const saved of [null, { textusAi: true, enableAskAi: true }]) {
    const settings = normalise.normaliseSettings(saved);
    expect(settings.textusAi).toBe(false);
    expect(features.aiFeatures(settings, true).chat).toBe(false);
  }
});

it("offers no Textus AI page, and the tour skips the AI chapters", async () => {
  const { pages, tour } = await withoutAi();
  expect(pages.settingsPages().map((p) => p.id)).not.toContain("ai");
  expect(tour.TUTORIAL_STEPS.map((s) => s.chapter)).not.toContain("ai");
  expect(tour.TUTORIAL_STEPS.map((s) => s.id)).not.toContain("connect");
  expect(tour.TUTORIAL_CHAPTERS.map((c) => c.id)).toEqual([
    "start",
    "writing",
    "done",
  ]);
});

it("is offered everywhere else", async () => {
  vi.resetModules();
  const { hasTextusAi } = await import("./capabilities");
  const { TUTORIAL_STEPS } = await import("../onboarding/tutorial-steps");
  expect(hasTextusAi).toBe(true);
  expect(TUTORIAL_STEPS.map((s) => s.id)).toContain("connect");
});
