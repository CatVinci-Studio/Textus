import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentMode_Serialize } from "../platform/bindings/ai-project";
import { CHAT_MODES, type AgentMode, type ChatMode } from "./settings-types";

describe("the agent's modes", () => {
  it("are Rust's AgentMode, Research among them", () => {
    expectTypeOf<AgentMode>().toEqualTypeOf<AgentMode_Serialize>();
    expectTypeOf<Exclude<AgentMode, ChatMode>>().toEqualTypeOf<"research">();
  });

  it("send a chat message in every mode but Research", () => {
    expectTypeOf(CHAT_MODES).toEqualTypeOf<readonly ChatMode[]>();
    expect(CHAT_MODES).not.toContain("research");
  });
});
