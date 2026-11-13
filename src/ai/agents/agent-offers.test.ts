import { beforeEach, describe, expect, it, vi } from "vitest";

const chosen: Record<string, Record<string, string>> = {};
vi.mock("../../prefs/settings-store", () => ({
  loadSettings: () => ({ agentOptions: chosen }),
}));
vi.mock("../../storage/ui-state", () => ({
  getUiState: () => null,
  setUiState: () => {},
}));

const { applyChoices, offerOf, resetOffersForTests } =
  await import("./agent-offers");

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
});
