import type { ComponentType } from "react";
import type { Strings } from "../i18n/strings";
import { hasTextusAi, isIOSApp } from "../platform/capabilities";
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
import { AboutPage } from "./pages/AboutPage";
import { AppearancePage, ThemeStorePage } from "./pages/AppearancePage";
import { ChatWritingPage } from "./pages/ChatWritingPage";
import {
  EditExportPage,
  EditImagesPage,
  EditMarkdownPage,
  EditTextPage,
} from "./pages/EditorPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { GeneralPage } from "./pages/GeneralPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { MemoryPage } from "./pages/MemoryPage";
import { McpPage } from "./pages/McpPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import type { SettingsPageProps } from "./pages/types";

const NAV_ICON = 15;
import { PrivacySection } from "./sections/privacy";

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
  Page: ComponentType<SettingsPageProps>;
}

export type SettingsGroupId = "look" | "edit" | "ai";

/** The groups pages are listed under: a name and an icon, folded until
 *  opened. */
export const SETTINGS_GROUPS: Record<
  SettingsGroupId,
  { label: (t: Strings) => string; Icon: ComponentType<{ className?: string }> }
> = {
  look: { label: (t) => t.navAppearance, Icon: lucide(Palette, NAV_ICON) },
  edit: { label: (t) => t.navEditing, Icon: lucide(PenLine, NAV_ICON) },
  ai: { label: (t) => t.navAi, Icon: lucide(Sparkles, NAV_ICON) },
};

const ai = () => hasTextusAi;

const BUILT_IN: SettingsPageDef[] = [
  {
    id: "general",
    label: (t) => t.navGeneral,
    Icon: lucide(SlidersHorizontal, NAV_ICON),
    Page: GeneralPage,
  },
  {
    id: "look-basic",
    group: "look",
    label: (t) => t.navLookBasic,
    Page: AppearancePage,
  },
  {
    id: "store",
    group: "look",
    label: (t) => t.navThemeStore,
    Page: ThemeStorePage,
  },
  {
    id: "edit-text",
    group: "edit",
    label: (t) => t.navEditText,
    Page: EditTextPage,
  },
  {
    id: "edit-md",
    group: "edit",
    label: () => "Markdown",
    Page: EditMarkdownPage,
  },
  {
    id: "edit-img",
    group: "edit",
    label: (t) => t.navEditImages,
    Page: EditImagesPage,
  },
  {
    id: "edit-export",
    group: "edit",
    label: (t) => t.menuExport,
    Page: EditExportPage,
  },
  {
    id: "providers",
    group: "ai",
    available: ai,
    label: (t) => t.navProvidersModels,
    Page: ProvidersPage,
  },
  {
    id: "chat",
    group: "ai",
    available: ai,
    label: (t) => t.navChatWriting,
    Page: ChatWritingPage,
  },
  {
    id: "memory",
    group: "ai",
    available: ai,
    label: (t) => t.navMemorySkills,
    Page: MemoryPage,
  },
  { id: "mcp", group: "ai", available: ai, label: () => "MCP", Page: McpPage },
  // The iPhone's and iPad's: there plugins, themes and skills are managed
  // in Settings; the desktop has the sidebar's plugins and these pages.
  {
    id: "extensions",
    label: (t) => t.navExtensions,
    available: () => isIOSApp,
    Page: ExtensionsPage,
  },
  {
    id: "shortcuts",
    label: (t) => t.navShortcuts,
    Icon: lucide(Keyboard, NAV_ICON),
    // A phone has no keyboard to bind shortcuts on.
    available: () => !isIOSApp,
    Page: ShortcutsPage,
  },
  {
    id: "privacy",
    label: (t) => t.navPrivacyData,
    Icon: lucide(ShieldCheck, NAV_ICON),
    Page: ({ t }) => <PrivacySection t={t} />,
  },
  {
    id: "about",
    label: (t) => t.navAbout,
    Icon: lucide(Info, NAV_ICON),
    Page: AboutPage,
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
