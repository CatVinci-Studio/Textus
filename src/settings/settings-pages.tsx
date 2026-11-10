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
import { AiPage } from "./pages/AiPage";
import { AppearancePage } from "./pages/AppearancePage";
import { ChatWritingPage } from "./pages/ChatWritingPage";
import { EditorPage } from "./pages/EditorPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { GeneralPage } from "./pages/GeneralPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { ModelsPage } from "./pages/ModelsPage";
import { MemoryPage } from "./pages/MemoryPage";
import { McpPage } from "./pages/McpPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { SkillsPage } from "./pages/SkillsPage";
import type { SettingsPageProps } from "./pages/types";
import { PrivacySection } from "./sections/privacy";

/** A Settings page: its id, its name in the navigation and the line under
 *  its title, its icon (a top page's), the page it sits under (Textus AI's
 *  three), whether this platform shows it, and its component. Plugins add
 *  theirs the same way. */
export interface SettingsPageDef {
  id: string;
  label: (t: Strings) => string;
  lead?: (t: Strings) => string;
  Icon?: ComponentType<{ className?: string }>;
  parent?: string;
  /** Left out where it means nothing (Shortcuts on a phone). */
  available?: () => boolean;
  Page: ComponentType<SettingsPageProps>;
}

const NAV_ICON = 15;

const BUILT_IN: SettingsPageDef[] = [
  {
    id: "general",
    label: (t) => t.navGeneral,
    lead: (t) => t.leadGeneral,
    Icon: lucide(SlidersHorizontal, NAV_ICON),
    Page: GeneralPage,
  },
  {
    id: "appearance",
    label: (t) => t.navAppearance,
    lead: (t) => t.leadAppearance,
    Icon: lucide(Palette, NAV_ICON),
    Page: AppearancePage,
  },
  {
    id: "editor",
    label: (t) => t.navEditing,
    lead: (t) => t.leadEditing,
    Icon: lucide(PenLine, NAV_ICON),
    Page: EditorPage,
  },
  {
    id: "ai",
    label: (t) => t.navAi,
    lead: (t) => t.leadAi,
    Icon: lucide(Sparkles, NAV_ICON),
    available: () => hasTextusAi,
    Page: AiPage,
  },
  {
    id: "providers",
    parent: "ai",
    label: (t) => t.navProviders,
    lead: (t) => t.leadProviders,
    available: () => hasTextusAi,
    Page: ProvidersPage,
  },
  {
    id: "models",
    parent: "ai",
    label: (t) => t.navModels,
    lead: (t) => t.leadModels,
    available: () => hasTextusAi,
    Page: ModelsPage,
  },
  {
    id: "chat",
    parent: "ai",
    label: (t) => t.navChatWriting,
    lead: (t) => t.leadChatWriting,
    available: () => hasTextusAi,
    Page: ChatWritingPage,
  },
  {
    id: "memory",
    parent: "ai",
    label: (t) => t.navMemory,
    lead: (t) => t.leadMemory,
    available: () => hasTextusAi,
    Page: MemoryPage,
  },
  {
    id: "skills",
    parent: "ai",
    label: (t) => t.navSkills,
    lead: (t) => t.leadSkills,
    available: () => hasTextusAi,
    Page: SkillsPage,
  },
  {
    id: "mcp",
    parent: "ai",
    label: () => "MCP",
    lead: (t) => t.leadMcp,
    available: () => hasTextusAi,
    Page: McpPage,
  },
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
    lead: (t) => t.leadPrivacy,
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
