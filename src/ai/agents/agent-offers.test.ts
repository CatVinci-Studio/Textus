import { beforeEach, describe, expect, it, vi } from "vitest";

const chosen: Record<string, Record<string, string>> = {};
vi.mock("../../prefs/settings-store", () => ({
  loadSettings: () => ({ agentOptions: chosen }),
}));
vi.mock("../../storage/ui-state", () => ({
  getUiState: () => null,
  setUiState: () => {},
}));

const { applyChoices, choicesToSend, offerOf, resetOffersForTests, wantedNow } =
  await import("./agent-offers");
const { addAgents } = await import("../../plugins/contributions/agents");

const select = (
  id: string,
  category: string,
  current: string,
  values: string[],
) => ({
  id,
  category,
  type: "select",
  currentValue: current,
  options: values.map((value) => ({ value, name: value })),
});
// Claude Code's: bypass by its own settings, effort by the model.
const claude = () => [
  select("mode", "mode", "bypassPermissions", ["default", "bypassPermissions"]),
  select("model", "model", "opus", ["opus", "sonnet"]),
  select("effort", "thought_level", "medium", ["low", "medium", "high"]),
];

beforeEach(() => {
  resetOffersForTests();
  for (const key of Object.keys(chosen)) delete chosen[key];
});

describe("an agent's options as a session opens", () => {
  it("asks first unless told otherwise, and sets what the user chose in order", async () => {
    chosen["x/claude"] = { model: "sonnet", effort: "high", gone: "1" };
    const sent: string[] = [];
    await applyChoices("x/claude", claude(), async (id, value) => {
      sent.push(`${id}=${value}`);
      // Sonnet offers no "high": the agent's answer is read before effort.
      if (id === "model")
        return {
          configOptions: [
            select("mode", "mode", "default", ["default", "bypassPermissions"]),
            select("model", "model", "sonnet", ["opus", "sonnet"]),
            select("effort", "thought_level", "medium", ["low", "medium"]),
          ],
        };
      return null;
    });
    expect(sent).toEqual(["mode=default", "model=sonnet"]);
    expect(offerOf("x/claude").options.map((o) => o.current)).toEqual([
      "default",
      "sonnet",
      "medium",
    ]);
  });

  it("keeps a mode the user chose that doesn't ask", async () => {
    chosen["x/claude"] = { mode: "bypassPermissions" };
    const sent: string[] = [];
    await applyChoices("x/claude", claude(), async (id, value) => {
      sent.push(`${id}=${value}`);
      return null;
    });
    expect(sent).toEqual([]);
  });

  it("turns an allow-all switch of the agent's own off unless chosen (Copilot's)", async () => {
    const copilot = () => [
      select("mode", "mode", "#agent", ["#agent", "#plan", "#autopilot"]),
      select("allow_all", "permissions", "on", ["on", "off"]),
    ];
    const sent: string[] = [];
    const set = async (id: string, value: string) => {
      sent.push(`${id}=${value}`);
      return null;
    };
    await applyChoices("x/copilot", copilot(), set);
    expect(sent).toEqual(["allow_all=off"]);
    chosen["x/copilot"] = { allow_all: "on" };
    sent.length = 0;
    await applyChoices("x/copilot", copilot(), set);
    expect(sent).toEqual([]);
  });

  it("skips a model the agent turns down, but never a refused mode", async () => {
    chosen["x/claude"] = { model: "sonnet", effort: "high" };
    const sent: string[] = [];
    await applyChoices("x/claude", claude(), async (id, value) => {
      sent.push(`${id}=${value}`);
      if (id === "model") throw new Error("not on this plan");
      return null;
    });
    expect(sent).toEqual(["mode=default", "model=sonnet", "effort=high"]);
    await expect(
      applyChoices("x/claude", claude(), async (id) => {
        if (id === "mode") throw new Error("no");
        return null;
      }),
    ).rejects.toThrow("no");
  });

  it("falls back to the mode that asks when a chosen one is refused (Gemini's untrusted folder)", async () => {
    const gemini = () => [
      select("mode", "mode", "default", ["default", "autoEdit", "yolo"]),
    ];
    chosen["x/gemini"] = { mode: "autoEdit" };
    const sent: string[] = [];
    await applyChoices("x/gemini", gemini(), async (id, value) => {
      sent.push(`${id}=${value}`);
      if (value === "autoEdit") throw new Error("untrusted folder");
      return null;
    });
    expect(sent).toEqual(["mode=autoEdit", "mode=default"]);
    expect(offerOf("x/gemini").options[0].current).toBe("default");
    // Not sent again after the start, or each message would be refused.
    expect(choicesToSend("x/gemini")).toEqual([]);
    // Nor ticked in the picker: the mode it runs in is.
    const [mode] = offerOf("x/gemini").options;
    expect(
      wantedNow(
        "x/gemini",
        mode,
        offerOf("x/gemini").options,
        chosen["x/gemini"],
      ),
    ).toBeNull();
  });

  it("takes the mode that asks from the agent's plugin when its names don't say", async () => {
    const remove = addAgents("x", [
      { id: "odd", name: "Odd", askMode: "careful" },
    ]);
    const odd = () => [select("mode", "mode", "free", ["free", "careful"])];
    const sent: string[] = [];
    await applyChoices("x/odd", odd(), async (id, value) => {
      sent.push(`${id}=${value}`);
      return null;
    });
    remove();
    expect(sent).toEqual(["mode=careful"]);
  });
});
