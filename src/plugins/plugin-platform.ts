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

/** Whether the market offers a plugin here: it runs here, and where there
 *  is no Textus AI (iOS) it doesn't need it. */
export function offeredHere(
  manifest: PluginManifest,
  textusAi: boolean = hasTextusAi,
): boolean {
  return runsHere(manifest) && (textusAi || !manifest.needsTextusAi);
}

/** Whether the store marks it as the computer's only. */
export const desktopOnly = (manifest: Pick<PluginManifest, "platforms">) =>
  !manifest.platforms.includes("ios");

/** Whether a plugin may run in this Textus: its version range and its
 *  platforms both fit. */
export function fitsHere(manifest: PluginManifest): boolean {
  return engineSatisfied(manifest.engine, APP_VERSION) && runsHere(manifest);
}
