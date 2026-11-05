import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";
import type { PluginStatus } from "./lifecycle";
import {
  pluginOffer,
  shortReason,
  type OfferCaller,
  type OfferDeps,
} from "./offer-plugin";

const t = en as unknown as Strings;
const KANBAN = { name: "Kanban", description: "Boards from lists." };
const DATABASE = { name: "Database", description: "Tables of notes." };
const IMPORTER: OfferCaller = { id: "notion-import", name: "Notion Import" };

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
    failed: vi.fn(),
  } satisfies OfferDeps;
  const ask = pluginOffer(deps);
  const offer = (request: unknown, tr: Strings, caller = IMPORTER) =>
    ask(caller, request, tr);
  return { deps, offer };
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
      expect.objectContaining({ okLabel: t.pluginTurnOn }),
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

  it("names the plugin that asks and starts on Cancel", async () => {
    const { deps, offer } = setup();
    await offer({ id: "kanban" }, t);
    expect(deps.confirm.mock.calls[0]?.[1]).toMatchObject({
      title: "Notion Import",
      cancelLabel: t.cancel,
      focusCancel: true,
    });
  });

  it("doesn't hear a plugin again once declined, whatever it offers", async () => {
    const { deps, offer } = setup({
      official: { kanban: KANBAN, database: DATABASE },
      answer: false,
    });
    expect(await offer({ id: "kanban" }, t)).toBe(false);
    expect(await offer({ id: "database" }, t)).toBe(false);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    // Another plugin still may.
    await offer({ id: "database" }, t, { id: "other", name: "Other" });
    expect(deps.confirm).toHaveBeenCalledTimes(2);
  });

  it("answers true for a plugin that is on while another offer is open", async () => {
    const { deps, offer } = setup({
      official: { kanban: KANBAN, database: DATABASE },
      installed: { database: "on" },
    });
    let answer: (ok: boolean) => void = () => {};
    deps.confirm.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const kanban = offer({ id: "kanban" }, t);
    expect(await offer({ id: "database" }, t)).toBe(true);
    answer(false);
    expect(await kanban).toBe(false);
  });

  it("tells the user when the install they agreed to fails", async () => {
    const { deps, offer } = setup();
    const error = new Error("offline");
    deps.install.mockRejectedValueOnce(error);
    expect(await offer({ id: "kanban" }, t)).toBe(false);
    expect(deps.failed).toHaveBeenCalledWith(error, t);
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
