import { expect, it } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { installsText } from "./installs-text";

it("says how many installed it, and how many lately when any did", () => {
  const t = resolveStrings("en");
  expect(installsText({ installs: 1234, installs30: 120 }, t)).toBe(
    "1,234 installs · +120 in 30 days",
  );
  expect(installsText({ installs: 5, installs30: 0 }, t)).toBe("5 installs");
  expect(installsText({}, t)).toBeNull();
});
