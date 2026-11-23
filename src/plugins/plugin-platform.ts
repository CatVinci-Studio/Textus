import { hasTextusAi, isMobileApp } from "../platform/capabilities";
import { platformName } from "../platform/window-chrome";
import type { PluginManifest } from "./store/manifest-types";
import { engineSatisfied } from "./store/versions";
import { version as APP_VERSION } from "../../package.json";

/** The system as a plugin is told it (textus.env.platform). */
export function pluginPlatform(): string {
  return platformName();
}

/** Whether a plugin runs on this system (its manifest's platforms). */
export function runsHere(manifest: PluginManifest): boolean {
  // A plugin made for iOS's web view runs in Android's as well.
  return manifest.platforms.includes(isMobileApp ? "ios" : "desktop");
}

/** Contributions that go with tools for Textus AI without being anything
 *  of their own: a command that sets the tools' key. */
const WITH_AI_TOOLS: ReadonlySet<string> = new Set(["aiTools", "commands"]);

/** Whether all a plugin gives is tools for Textus AI (Keenable,
 *  Openverse): nothing to show or do without it. */
export function onlyForAi(manifest: Pick<PluginManifest, "contributes">) {
  const given = Object.entries(manifest.contributes).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : !!value,
  );
  return (
    manifest.contributes.aiTools.length > 0 &&
    given.every(([key, value]) =>
      key === "menus"
        ? Object.values(value as object).every((items) => !items?.length)
        : WITH_AI_TOOLS.has(key),
    )
  );
}

/** Whether the market offers a plugin here: it runs here, and it gives
 *  something without Textus AI where there is none (iOS). */
export function offeredHere(
  manifest: PluginManifest,
  textusAi: boolean = hasTextusAi,
): boolean {
  return runsHere(manifest) && (textusAi || !onlyForAi(manifest));
}

/** Whether a plugin may run in this Textus: its version range and its
 *  platforms both fit. */
export function fitsHere(manifest: PluginManifest): boolean {
  return engineSatisfied(manifest.engine, APP_VERSION) && runsHere(manifest);
}
