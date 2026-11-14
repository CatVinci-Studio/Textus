import type { ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { hasTextusAi, isIOSApp, isMobileApp } from "../platform/capabilities";
import { lucide } from "../engine/controls/icons";
import {
  Info,
  Keyboard,
  Palette,
  PenLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { SettingsPageProps } from "./pages/types";

const NAV_ICON = 15;

/** A Settings page: its id, its name in the list, its icon (a page of its
 *  own's), the group it is listed under (Appearance's, Editing's, Textus
 *  AI's), whether this platform shows it, and its component. Plugins add
 *  theirs the same way. */
export interface SettingsPageDef {
  id: string;
  label: (t: Strings) => string;
  Icon?: ComponentType<{ className?: string }>;
  group?: SettingsGroupId;
  /** Left out where it means nothing (Shortcuts on a phone). */
  available?: () => boolean;
  /** A plugin's page; the built-in ones' are builtin-pages.tsx's, loaded
   *  with Settings, not at startup. */
  Page?: ComponentType<SettingsPageProps>;
}

export type SettingsGroupId = "edit" | "ai";

/** The groups pages are listed under: a name and an icon, folded until
 *  opened. */
export const SETTINGS_GROUPS: Record<
  SettingsGroupId,
  { label: (t: Strings) => string; Icon: ComponentType<{ className?: string }> }
> = {
  edit: { label: (t) => t.navEditing, Icon: lucide(PenLine, NAV_ICON) },
  ai: { label: (t) => t.navAi, Icon: lucide(Sparkles, NAV_ICON) },
};

const ai = () => hasTextusAi;

const BUILT_IN: SettingsPageDef[] = [
  {
    id: "general",
    label: (t) => t.navGeneral,
    Icon: lucide(SlidersHorizontal, NAV_ICON),
  },
  {
    id: "look-basic",
    label: (t) => t.navAppearance,
    Icon: lucide(Palette, NAV_ICON),
  },
  {
    id: "edit-text",
    group: "edit",
    label: (t) => t.navEditText,
  },
  {
    id: "edit-img",
    group: "edit",
    label: (t) => t.navEditImages,
  },
  {
    id: "edit-export",
    group: "edit",
    label: (t) => t.menuExport,
  },
  {
    id: "providers",
    group: "ai",
    available: ai,
    label: (t) => t.navProvidersModels,
  },
  {
    id: "chat",
    group: "ai",
    available: ai,
    label: (t) => t.navChatWriting,
  },
  {
    id: "memory",
    group: "ai",
    available: ai,
    label: (t) => t.navMemorySkills,
  },
  // MCP servers and external agents run on the desktop only.
  {
    id: "mcp",
    group: "ai",
    available: () => hasTextusAi && !isMobileApp,
    label: (t) => t.navExternalTools,
  },
  // The iPhone's and iPad's: there plugins, themes and skills are managed
  // in Settings; the desktop has the sidebar's plugins and these pages.
  {
    id: "extensions",
    label: (t) => t.navExtensions,
    available: () => isIOSApp,
  },
  {
    id: "shortcuts",
    label: (t) => t.navShortcuts,
    Icon: lucide(Keyboard, NAV_ICON),
    // A phone has no keyboard to bind shortcuts on.
    available: () => !isMobileApp,
  },
  {
    id: "privacy",
    label: (t) => t.navPrivacyData,
    Icon: lucide(ShieldCheck, NAV_ICON),
  },
  {
    id: "about",
    label: (t) => t.navAbout,
    Icon: lucide(Info, NAV_ICON),
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

export function settingsPages(): SettingsPageDef[] {
  return [...BUILT_IN, ...added].filter((p) => p.available?.() ?? true);
}

export function settingsPage(id: string): SettingsPageDef | undefined {
  return settingsPages().find((p) => p.id === id);
}
