import { describe, expect, it } from "vitest";
import { explainError } from "./error-explain";
import en from "../i18n/locales/en";
import zh from "../i18n/locales/zh";

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

  it("replaces Textus' own English", () => {
    expect(explainError("Invalid name", zh)).toBe(zh.errorBadName);
    expect(explainError("The file is too big to open here.", zh)).toBe(
      zh.errorFileTooBig,
    );
    expect(explainError("PDF export failed", zh)).toBe("");
    expect(explainError("PDF export timed out", zh)).toBe(zh.errorTimeout);
  });

  it("leaves a broken pipe and anything unknown as they came", () => {
    expect(explainError("Broken pipe (os error 32)", en)).toBe(
      "Broken pipe (os error 32)",
    );
    expect(explainError("something odd", en)).toBe("something odd");
  });
});
