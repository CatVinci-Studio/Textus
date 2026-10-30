import type { ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { hasTextusAi, isIOSApp } from "../platform/capabilities";
import { AiPage } from "./pages/AiPage";
import { EditorPage } from "./pages/EditorPage";
import { GeneralPage } from "./pages/GeneralPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import type { SettingsPageProps } from "./pages/types";
import { PrivacySection } from "./sections/privacy";

/**
 * The pages of Settings, in the order its navigation lists them - the one
 * list the panel (SettingsPanel.tsx), its search and its phone tabs read.
 * A page is an id, its name in the navigation, whether this platform shows
 * it, and the component that draws it from SettingsPageProps.
 *
 * Built in for now. It is the shape a plugin's own page will take
 * (docs/dev/plugin-api.md): registerSettingsPage adds one after the built-in
 * pages, and its rows find their way into the search like any other's.
 */
export interface SettingsPageDef {
  id: string;
  label: (t: Strings) => string;
  /** Left out where it means nothing (Shortcuts on a phone). */
  available?: () => boolean;
  Page: ComponentType<SettingsPageProps>;
}

const BUILT_IN: SettingsPageDef[] = [
  { id: "general", label: (t) => t.navGeneral, Page: GeneralPage },
  { id: "editor", label: (t) => t.navEditor, Page: EditorPage },
  {
    id: "ai",
    label: (t) => t.navAi,
    available: () => hasTextusAi,
    Page: AiPage,
  },
  {
    id: "extensions",
    label: (t) => t.navExtensions,
    // Desktop only for now: a phone has no plugin to install from a file
    // or a folder, nor a program to start as an MCP server, and its
    // Settings tabs have room for four (its skills stay in Textus AI).
    available: () => !isIOSApp,
    Page: ExtensionsPage,
  },
  {
    id: "shortcuts",
    label: (t) => t.navShortcuts,
    // A phone has no keyboard to bind shortcuts on.
    available: () => !isIOSApp,
    Page: ShortcutsPage,
  },
  {
    id: "privacy",
    label: (t) => t.navPrivacy,
    Page: ({ t }) => <PrivacySection t={t} />,
  },
];

const added: SettingsPageDef[] = [];

/** Adds a page after the built-in ones; the returned function takes it
 *  away again. An id already taken is refused. */
export function registerSettingsPage(page: SettingsPageDef): () => void {
  if (settingsPages().some((p) => p.id === page.id))
    throw new Error(`A Settings page "${page.id}" is already registered.`);
  added.push(page);
  return () => {
    const at = added.indexOf(page);
    if (at >= 0) added.splice(at, 1);
  };
}

/** The pages this platform shows, in navigation order. */
export function settingsPages(): SettingsPageDef[] {
  return [...BUILT_IN, ...added].filter((p) => p.available?.() ?? true);
}

/** The page with this id, or undefined. */
export function settingsPage(id: string): SettingsPageDef | undefined {
  return settingsPages().find((p) => p.id === id);
}
