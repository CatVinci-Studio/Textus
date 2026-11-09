import { isIOSApp } from "../platform/capabilities";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import type { PluginManifest } from "./store/manifest";

/** The system as a plugin is told it (textus.env.platform). */
export function pluginPlatform(): string {
  if (isIOSApp) return "ios";
  if (isMacPlatform()) return "macos";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

/** Whether a plugin runs on this system (its manifest's platforms). */
export function runsHere(manifest: PluginManifest): boolean {
  return manifest.platforms.includes(isIOSApp ? "ios" : "desktop");
}
