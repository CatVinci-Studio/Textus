import { expect, it } from "vitest";
import { errorText } from "./error-text";

it("reads the message of a structured backend error instead of [object Object]", () => {
  const ipc = Object.assign(new Error("media_synthesize: x"), {
    name: "IpcError",
    cause: { code: "invalid_request", message: "Speech requires a voice" },
  });
  expect(errorText(ipc)).toBe("Speech requires a voice");
  expect(errorText({ code: "timeout", message: "Timed out" })).toBe(
    "Timed out",
  );
  expect(errorText("plain")).toBe("plain");
});
