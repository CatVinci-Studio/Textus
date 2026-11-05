import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";
import type { PluginStatus } from "./lifecycle";
import { pluginOffer, shortReason, type OfferDeps } from "./offer-plugin";

const t = en as unknown as Strings;
const KANBAN = { name: "Kanban", description: "Boards from lists." };

function setup({
  official = { kanban: KANBAN } as Record<string, typeof KANBAN>,
  installed = {} as Record<string, PluginStatus>,
  answer = true,
} = {}) {
  const statuses = { ...installed };
  const deps = {
    official: vi.fn(async (id: string) => official[id] ?? null),
    status: (id: string) => statuses[id],
    confirm: vi.fn<OfferDeps["confirm"]>(async () => answer),
    install: vi.fn(async (id: string) => {
      statuses[id] = "on";
    }),
    turnOn: vi.fn(async (id: string) => {
      statuses[id] = "on";
    }),
  } satisfies OfferDeps;
  return { deps, offer: pluginOffer(deps) };
}

describe("textus.offerPlugin", () => {
  it("refuses an id the catalog has no official plugin for, without asking", async () => {
    const { deps, offer } = setup({ official: {} });
    expect(await offer({ id: "someones-plugin" }, t)).toBe(false);
    expect(await offer({ id: 42 }, t)).toBe(false);
    expect(await offer(undefined, t)).toBe(false);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("answers true for a plugin already on, without asking", async () => {
    const { deps, offer } = setup({ installed: { kanban: "on" } });
    expect(await offer({ id: "kanban" }, t)).toBe(true);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("asks to turn on an installed plugin that is off, and turns it on", async () => {
    const { deps, offer } = setup({ installed: { kanban: "off" } });
    expect(await offer({ id: "kanban" }, t)).toBe(true);
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.stringContaining("installed but off"),
      { okLabel: t.pluginTurnOn, cancelLabel: t.cancel },
    );
    expect(deps.turnOn).toHaveBeenCalledWith("kanban");
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("doesn't offer an installed plugin that can't be turned on", async () => {
    const { deps, offer } = setup({ installed: { kanban: "incompatible" } });
    expect(await offer({ id: "kanban" }, t)).toBe(false);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("asks with the name, description and reason, then installs", async () => {
    const { deps, offer } = setup();
    const on = await offer(
      { id: "kanban", reason: "Track the pages you imported." },
      t,
    );
    expect(on).toBe(true);
    const [text, labels] = deps.confirm.mock.calls[0]!;
    expect(text).toContain("Kanban");
    expect(text).toContain("Boards from lists.");
    expect(text).toContain("“Track the pages you imported.”");
    expect(labels.okLabel).toBe(t.pluginInstall);
    expect(deps.install).toHaveBeenCalledWith("kanban");
  });

  it("shows the reason as written, even when it looks like a placeholder", async () => {
    const { deps, offer } = setup();
    await offer({ id: "kanban", reason: "<b>{name}</b> $& {description}" }, t);
    expect(deps.confirm.mock.calls[0]?.[0]).toContain(
      "“<b>{name}</b> $& {description}”",
    );
  });

  it("resolves false when declined, and doesn't ask again", async () => {
    const { deps, offer } = setup({ answer: false });
    expect(await offer({ id: "kanban" }, t)).toBe(false);
    expect(await offer({ id: "kanban" }, t)).toBe(false);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("shows one dialog when a plugin calls it in a loop", async () => {
    const { deps, offer } = setup();
    let answer: (ok: boolean) => void = () => {};
    deps.confirm.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const first = offer({ id: "kanban" }, t);
    const rest = Array.from({ length: 5 }, () => offer({ id: "kanban" }, t));
    expect(await Promise.all(rest)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    await vi.waitFor(() => expect(deps.confirm).toHaveBeenCalledTimes(1));
    answer(true);
    expect(await first).toBe(true);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
  });
});

describe("shortReason", () => {
  it("keeps one line of at most 120 characters", () => {
    expect(shortReason("  two\nlines  ")).toBe("two lines");
    const long = shortReason("x".repeat(300));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
    expect(shortReason(undefined)).toBe("");
  });
});
