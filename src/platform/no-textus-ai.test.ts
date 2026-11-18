// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

// iOS, which goes without Textus AI.
async function withoutAi() {
  vi.resetModules();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
  );
  return {
    normalise: await import("../prefs/settings-normalise"),
    pages: await import("../settings/settings-pages"),
    tour: await import("../onboarding/tutorial-steps"),
    features: await import("../prefs/ai-features"),
    permissions: await import("../plugins/store/permissions"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
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

it("offers no Textus AI page, and the tour skips the AI steps", async () => {
  const { pages, tour } = await withoutAi();
  expect(pages.settingsPages().map((p) => p.id)).not.toContain("ai");
  expect(tour.TUTORIAL_STEPS.filter((s) => s.ai)).toEqual([]);
});

it("names no AI permission when a plugin asks for one", async () => {
  const { permissions } = await withoutAi();
  expect(
    permissions.shownPermissions(["ai.tools", "ai.model", "network:x.org"]),
  ).toEqual(["network:x.org"]);
});

it("is offered everywhere else", async () => {
  vi.resetModules();
  const { hasTextusAi } = await import("./capabilities");
  const { TUTORIAL_STEPS } = await import("../onboarding/tutorial-steps");
  expect(hasTextusAi).toBe(true);
  expect(TUTORIAL_STEPS.map((s) => s.id)).toContain("signin");
});
