import { describe, expect, it } from "vitest";
import { fileUri } from "./agent-exchange";

describe("the document a prompt points at", () => {
  it("is a file: URI with its spaces and marks encoded", () => {
    expect(fileUri("/Users/me/Week45/Nov 8.md")).toBe(
      "file:///Users/me/Week45/Nov%208.md",
    );
    expect(fileUri("/a/#plan?.md")).toBe("file:///a/%23plan%3F.md");
    expect(fileUri("C:\\Notes\\周报.md")).toBe(
      "file:///C:/Notes/%E5%91%A8%E6%8A%A5.md",
    );
  });
});
