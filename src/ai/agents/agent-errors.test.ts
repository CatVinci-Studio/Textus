import { describe, expect, it } from "vitest";
import type { ExternalAgent } from "../../plugins/contributions/agents";
import { AcpError } from "./acp-client";
import { explain } from "./agent-errors";

const codex = { name: "Codex", setup: "Needs Node.js." } as ExternalAgent;

describe("an agent's error as the user reads it", () => {
  it("gives the agent's own reason, without the setup, once it runs", () => {
    const limit = new AcpError("Internal error", -32603, {
      message: "You've hit your usage limit.",
    });
    expect(explain(codex, limit).message).toBe("You've hit your usage limit.");
  });

  it("adds the setup only when it fails to start", () => {
    const spawn = new Error("spawn npx ENOENT");
    expect(explain(codex, spawn, true).message).toBe(
      "spawn npx ENOENT\n\nNeeds Node.js.",
    );
    expect(explain(codex, spawn).message).toBe("spawn npx ENOENT");
  });
});
