/**
 * Whether the app shows its ways into plugins: Settings › Extensions'
 * Plugins tab, and the Plugins menu. 1.2 ships the plugin system without
 * plugins to install, so a release build keeps them out of sight; a
 * development build (and so every e2e run) shows them, and so does a
 * build made with VITE_TEXTUS_PLUGINS=1. menu.rs's PLUGINS_SHOWN decides
 * the native menu the same way. The runtime itself runs either way - with
 * nothing installed it does nothing.
 */
export const PLUGINS_SHOWN: boolean =
  import.meta.env.DEV || import.meta.env.VITE_TEXTUS_PLUGINS === "1";
