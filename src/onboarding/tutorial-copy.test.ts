import { describe, expect, it } from "vitest";
import { LANGS, resolveStrings, type TextKey } from "../i18n/strings";
import { TUTORIAL_STEPS } from "./tutorial-steps";
import { withCode } from "./with-code";

// The tour's copy as the learner reads it, in every language.
describe.each(LANGS)("the tour in %s", (lang) => {
  const t = resolveStrings(lang);
  const keys = TUTORIAL_STEPS.flatMap((step) =>
    [
      step.bodyKey,
      step.phoneBodyKey,
      ...(step.stops ?? []).map((stop) => stop.key),
    ].filter((key): key is TextKey => !!key),
  );

  it("keeps each line short, on one line, its code spans closed", () => {
    for (const key of keys) {
      expect(t[key], key).not.toContain("\n");
      const prose = withCode(t[key]).filter((p) => typeof p === "string");
      expect(prose.join(""), key).not.toContain("`");
    }
  });
});
