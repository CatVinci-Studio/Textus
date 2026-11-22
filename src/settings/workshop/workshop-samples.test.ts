import { describe, expect, it } from "vitest";
import { LANGS } from "../../i18n/langs";
import { WORKSHOP_SAMPLES } from "./workshop-samples";

describe("the workshop's sample pages", () => {
  it.each(LANGS)("%s has every block a theme styles", (lang) => {
    const page = WORKSHOP_SAMPLES[lang];
    for (const block of [
      /^# \S/m,
      /^## \S/m,
      /^### \S/m,
      /\*\*[^*]+\*\*/,
      /^- \S/m,
      /^1\. \S/m,
      /^> \S/m,
      /^```js$/m,
      /^\| --- \|/m,
      /^\$\$$/m,
    ])
      expect(page).toMatch(block);
    // Raw HTML would show as text in a theme without it.
    expect(page).not.toMatch(/<\/?u>/);
  });
});
