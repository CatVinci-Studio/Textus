import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";
import type { PluginStatus } from "./lifecycle";
import { pluginOffer, type OfferCaller, type OfferDeps } from "./offer-plugin";
import type { CardResult } from "./plugin-card";

const t = en as unknown as Strings;
const IMPORTER: OfferCaller = { id: "notion-import", name: "Notion Import" };

function setup({
  official = ["kanban"],
  installed = {} as Record<string, PluginStatus>,
  answer = "install" as CardResult,
} = {}) {
  const statuses = { ...installed };
  const deps = {
    official: vi.fn(async (id: string) => official.includes(id)),
    status: (id: string) => statuses[id],
    card: vi.fn<OfferDeps["card"]>(async () => answer),
    install: vi.fn(async (id: string) => {
      statuses[id] = "on";
    }),
    turnOn: vi.fn(async (id: string) => {
      statuses[id] = "on";
    }),
    failed: vi.fn(),
  } satisfies OfferDeps;
  const ask = pluginOffer(deps);
  const offer = (request: unknown, caller = IMPORTER) =>
    ask(caller, request, t);
  return { deps, offer };
}

describe("textus.offerPlugin", () => {
  it("refuses an id the catalog has no official plugin for, without a card", async () => {
    const { deps, offer } = setup({ official: [] });
    expect(await offer({ id: "someones-plugin" })).toBe(false);
    expect(await offer({ id: 42 })).toBe(false);
    expect(await offer(undefined)).toBe(false);
    expect(deps.card).not.toHaveBeenCalled();
  });

  it("answers true for a plugin already on, without a card", async () => {
    const { deps, offer } = setup({ installed: { kanban: "on" } });
    expect(await offer({ id: "kanban" })).toBe(true);
    expect(deps.card).not.toHaveBeenCalled();
  });

  it("suggests turning on an installed plugin that is off, and turns it on", async () => {
    const { deps, offer } = setup({ installed: { kanban: "off" } });
    expect(await offer({ id: "kanban" })).toBe(true);
    expect(deps.card.mock.calls[0][0]).toMatchObject({ installed: true });
    expect(deps.turnOn).toHaveBeenCalledWith("kanban");
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("doesn't offer an installed plugin that can't be turned on", async () => {
    const { deps, offer } = setup({ installed: { kanban: "incompatible" } });
    expect(await offer({ id: "kanban" })).toBe(false);
    expect(deps.card).not.toHaveBeenCalled();
  });

  it("shows the card for the caller, then installs", async () => {
    const { deps, offer } = setup();
    expect(await offer({ id: "kanban", reason: "ignored" })).toBe(true);
    expect(deps.card).toHaveBeenCalledWith({
      plugin: "kanban",
      situation: { type: "offer", caller: IMPORTER },
      installed: false,
    });
    expect(deps.install).toHaveBeenCalledWith("kanban");
  });

  it.each(["later", "never", "busy", "muted"] as const)(
    "resolves false on %s, installing nothing",
    async (answer) => {
      const { deps, offer } = setup({ answer });
      expect(await offer({ id: "kanban" })).toBe(false);
      expect(deps.install).not.toHaveBeenCalled();
    },
  );

  it("tells the user when the install they agreed to fails", async () => {
    const { deps, offer } = setup();
    const error = new Error("offline");
    deps.install.mockRejectedValueOnce(error);
    expect(await offer({ id: "kanban" })).toBe(false);
    expect(deps.failed).toHaveBeenCalledWith(error, t);
  });
});
