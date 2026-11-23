// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { endProgress } from "../../engine/controls/notices";
import { finishExportPage } from "../../export/export-step";
import { chosenSource } from "../../ai/writing/inline-sources";
import { isFarUrl } from "../../platform/far-files";
import { fs } from "../../platform/ipc";
import { ssh } from "../../platform/ipc-ssh";
import { conventionsAppName } from "../../prefs/image-folder";
import { lateContextItems } from "../../registry/context-menu-items";
import { pluginFormats } from "../../registry/plugin-export-formats";
import { setPluginColors } from "../../theme/plugin-colors";
import { PLUGIN_COLORS_STYLE_ID } from "../../theme/style-ids";
import { addConventionReader } from "../contributions/convention-readers";
import {
  addDropHandler,
  dropClaimed,
  dropMatch,
} from "../contributions/drop-handlers";
import { setPluginEmbed } from "../contributions/embeds";
import { fileBadge, setFileBadge } from "../contributions/file-badges";
import {
  addHoverProvider,
  hasHoverProviders,
} from "../contributions/hover-providers";
import { listView, registerListView } from "../contributions/list-views";
import {
  addOutlineProvider,
  askOutline,
} from "../contributions/outline-providers";
import { claimKey, ownerOf } from "../contributions/owners";
import {
  addPasteHandler,
  pasteMatches,
  pastePattern,
} from "../contributions/paste-handlers";
import { pluginWhenKeys } from "../contributions/plugin-when-keys";
import { statusItemsSnapshot } from "../contributions/status-items";
import { setWillExport } from "../contributions/will-export";
import { hasWillSave, setWillSave } from "../contributions/will-save";
import { watchMetadata } from "../workspace/metadata-cache";
import { aiModelHandlers } from "./broker-ai";
import { databaseViewHandlers } from "./broker-database-views";
import { exportFormatHandlers } from "./broker-export";
import { historyHandlers } from "./broker-history";
import { providerHandlers } from "./broker-providers";
import type { PluginScope } from "./broker-scope";
import { forgetPlugin, PLUGIN_STOPS } from "./broker-stop";
import { stopPluginUi, UI_STOPS, uiHandlers } from "./broker-ui";

vi.mock("../../engine/controls/notices", async (real) => {
  const actual = await real<typeof import("../../engine/controls/notices")>();
  return { ...actual, endProgress: vi.fn(actual.endProgress) };
});

const P = "a.all";
const scope = {
  id: P,
  name: () => "All",
  t: () => ({ cancel: "Cancel" }),
  need: () => {},
  deps: { runCommand: vi.fn() },
  request: () => new Promise(() => {}),
} as unknown as PluginScope;

/** One of each thing a plugin can leave in the window: put there, and
 *  whether any of it is still there. Named as the stop that takes it. */
interface Probe {
  name: string;
  put(): void | Promise<void>;
  left(): boolean | Promise<boolean>;
}

const ui = uiHandlers(scope);
let progress = -1;
const removed = vi.spyOn(window, "removeEventListener");

const PROBES: Probe[] = [
  {
    name: "endProgressBars",
    put: () => {
      progress = ui["ui.progressStart"]({ title: "Working" });
    },
    left: () =>
      !vi.mocked(endProgress).mock.calls.some(([id]) => id === progress),
  },
  {
    name: "removeStatusItem",
    put: () => ui["ui.setStatusItem"]({ id: "s", text: "On" }),
    left: () => statusItemsSnapshot().some((item) => item.plugin === P),
  },
  {
    name: "forgetPluginWhenKeys",
    put: () => ui["commands.setContext"]({ key: `${P}.on`, value: true }),
    left: () => `${P}.on` in pluginWhenKeys(),
  },
  {
    name: "forgetFileBadges",
    put: () => setFileBadge(P, "/v/a.md", { text: "1" }),
    left: () => fileBadge("/v/a.md") !== null,
  },
  {
    name: "forgetPasteHandlers",
    put: () => addPasteHandler(P, "1", pastePattern("^ISBN"), async () => null),
    left: () => pasteMatches("ISBN 1"),
  },
  {
    name: "forgetDropHandlers",
    put: () =>
      addDropHandler(
        P,
        "1",
        dropMatch({ extensions: ["csv"] }),
        async () => null,
      ),
    left: () => dropClaimed("rows.csv", "attachment"),
  },
  {
    name: "removeOutlineProvider",
    put: () =>
      addOutlineProvider(P, async () => [{ text: "x", block: "b", level: 1 }]),
    left: async () => (await askOutline([])).length > 0,
  },
  {
    name: "removeMenuProviders",
    put: () => ui["ui.registerContextMenu"]({ where: "editor" }),
    left: () => lateContextItems("editor/context", { path: null }) !== null,
  },
  {
    name: "stopPluginEditor",
    put: () => addHoverProvider(P, async () => null),
    left: () => hasHoverProviders(),
  },
  {
    name: "stopPluginHistory",
    put: () =>
      historyHandlers(scope)["history.registerSource"]({ id: "h", label: "H" }),
    left: () => historyHandlers(scope)["history.sources"]().length > 0,
  },
  {
    name: "stopPluginAi",
    put: () =>
      aiModelHandlers(scope)["ai.registerInlineCompletion"]({ id: "i" }),
    left: () => chosenSource(`${P}#i`) !== null,
  },
  {
    name: "stopPluginExport",
    put: () =>
      exportFormatHandlers(scope)["export.registerFormat"]({
        id: "f",
        extension: "docx",
      }),
    left: () => pluginFormats().some((f) => f.plugin === P),
  },
  {
    name: "stopPluginDatabaseViews",
    put: () =>
      databaseViewHandlers(scope)["views.registerDatabaseView"]({ id: "d" }),
    left: () => databaseViewHandlers(scope)["views.databaseViews"]().length > 0,
  },
  {
    name: "stopPluginConventionReaders",
    put: () => {
      vi.spyOn(fs, "conventionReaders").mockResolvedValue(undefined as never);
      addConventionReader(`${P}#r`, "Reader", {
        plugin: P,
        marker: ".reader",
        notes: false,
        read: async () => null,
      });
    },
    left: () => conventionsAppName(`${P}#r`) === "Reader",
  },
  {
    name: "stopPluginProviders",
    put: () =>
      providerHandlers(scope)["files.registerProvider"]({ scheme: "allx" }),
    left: () => isFarUrl("allx://box/home"),
  },
  {
    name: "stopPluginSsh",
    put: () => {
      vi.spyOn(ssh, "close").mockResolvedValue(undefined as never);
    },
    left: () => !vi.mocked(ssh.close).mock.calls.some(([id]) => id === P),
  },
  {
    name: "forgetListViews",
    put: () => registerListView(P, "v", { select: false, check: false }),
    left: () => listView(P, "v") !== null,
  },
  {
    name: "forgetEmbeds",
    put: () => setPluginEmbed(P, "e", ["note"], async () => null),
    left: () => ownerOf(claimKey.embed("note")) === P,
  },
  {
    name: "forgetWillSave",
    put: () => setWillSave(P, true, async () => null),
    left: () => hasWillSave(),
  },
  {
    name: "forgetWillExport",
    put: () => setWillExport(P, true, async () => ({ css: ".all {}" })),
    left: async () =>
      (
        await finishExportPage({ format: "html", path: null, html: "<p></p>" })
      ).css.includes(".all"),
  },
  {
    name: "unwatchMetadata",
    put: () => watchMetadata(P),
    left: () => !removed.mock.calls.some(([type]) => type === "focus"),
  },
  {
    name: "forgetPluginColors",
    put: () => {
      setPluginColors(P, { "--ui-accent": "#cc0066" });
    },
    left: () => document.getElementById(PLUGIN_COLORS_STYLE_ID) !== null,
  },
];

async function stillThere(): Promise<string[]> {
  const left = await Promise.all(PROBES.map((probe) => probe.left()));
  return PROBES.filter((_, i) => left[i]).map((probe) => probe.name);
}

describe("a stopped plugin", () => {
  it("leaves nothing it put in the window", async () => {
    for (const probe of PROBES) await probe.put();
    expect(await stillThere()).toEqual(PROBES.map((probe) => probe.name));
    forgetPlugin(P);
    expect(await stillThere()).toEqual([]);
  });

  it("is checked for each stop there is", () => {
    const stops = PLUGIN_STOPS.flatMap((stop) =>
      stop === stopPluginUi ? UI_STOPS : [stop],
    );
    expect(stops.map((stop) => stop.name)).toEqual(
      PROBES.map((probe) => probe.name),
    );
  });
});
