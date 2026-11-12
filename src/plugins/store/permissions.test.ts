import { describe, expect, it } from "vitest";
import { hostAllowed } from "./permissions";

describe("hostAllowed", () => {
  it("reads a network grant as the Rust fetch does", () => {
    const granted = ["network:*.Example.com", "network:api.x.io:8443"];
    expect(hostAllowed(granted, "example.com", 443)).toBe(true);
    expect(hostAllowed(granted, "Docs.EXAMPLE.com", 443)).toBe(true);
    expect(hostAllowed(granted, "badexample.com", 443)).toBe(false);
    expect(hostAllowed(granted, "api.x.io", 8443)).toBe(true);
    expect(hostAllowed(granted, "api.x.io", 443)).toBe(false);
    expect(hostAllowed(["network:*"], "any.where", 443)).toBe(true);
    expect(hostAllowed(["files.read"], "any.where", 443)).toBe(false);
  });
});
