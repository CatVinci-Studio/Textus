import { describe, expect, it } from "vitest";
import { explainError } from "./error-explain";
import en from "../i18n/locales/en";
import zh from "../i18n/locales/zh";
import ERRORS from "../i18n/errors.json";

describe("explainError", () => {
  it.each([
    ["Permission denied (os error 13)", en.errorPermission],
    ["拒绝访问。 (os error 5)", en.errorPermission],
    ["No such file or directory (os error 2)", en.errorNotFound],
    ["No space left on device (os error 28)", en.errorDiskFull],
    ["磁盘空间不足。 (os error 112)", en.errorDiskFull],
    ["Read-only file system (os error 30)", en.errorReadOnly],
    [
      "The process cannot access the file because it is being used by another process. (os error 32)",
      en.errorFileBusy,
    ],
    ["error sending request for url (https://x)", en.errorNetwork],
    ["operation timed out", en.errorTimeout],
  ])("says what %s means above it", (raw, lead) => {
    expect(explainError(new Error(raw), en)).toBe(`${lead}\n${raw}`);
  });

  it("says Textus' own errors by their code, in the user's language", () => {
    expect(explainError("Invalid name. [badName]", zh)).toBe(zh.errorBadName);
    expect(explainError("Already exists. [exists]", zh)).toBe(zh.errorExists);
    expect(explainError("PDF export failed [pdfFailed]", zh)).toBe("");
    expect(explainError("PDF export timed out [pdfTimeout]", zh)).toBe(
      zh.errorTimeout,
    );
  });

  it("has words for every code the backend gives", () => {
    for (const [code, { text }] of Object.entries(ERRORS))
      if (text !== null) expect(en, code).toHaveProperty(text);
  });

  it("leaves a broken pipe and anything unknown as they came", () => {
    expect(explainError("Broken pipe (os error 32)", en)).toBe(
      "Broken pipe (os error 32)",
    );
    expect(explainError("something odd", en)).toBe("something odd");
  });
});
