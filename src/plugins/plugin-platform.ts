import { isMobileApp } from "../platform/capabilities";
import { platformName } from "../platform/window-chrome";
import type { PluginManifest } from "./store/manifest";

/** The system as a plugin is told it (textus.env.platform). */
export function pluginPlatform(): string {
  return platformName();
}

/** Whether a plugin runs on this system (its manifest's platforms). */
export function runsHere(manifest: PluginManifest): boolean {
  // A plugin made for iOS's web view runs in Android's as well.
  return manifest.platforms.includes(isMobileApp ? "ios" : "desktop");
}
