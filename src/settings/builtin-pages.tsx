import type { ComponentType } from "react";
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
import { PrivacySection } from "./sections/privacy";
import type { SettingsPageDef } from "./settings-pages";
import type { SettingsPageProps } from "./pages/types";

/** The built-in Settings pages' components, by page id: loaded with
 *  Settings (its tab, its sheet, its list's search), never at startup. */
const BUILT_IN: Record<string, ComponentType<SettingsPageProps>> = {
  general: GeneralPage,
  "look-basic": AppearancePage,
  store: ThemeStorePage,
  "edit-text": EditTextPage,
  "edit-md": EditMarkdownPage,
  "edit-img": EditImagesPage,
  "edit-export": EditExportPage,
  providers: ProvidersPage,
  chat: ChatWritingPage,
  memory: MemoryPage,
  mcp: McpPage,
  extensions: ExtensionsPage,
  shortcuts: ShortcutsPage,
  privacy: ({ t }) => <PrivacySection t={t} />,
  about: AboutPage,
};

/** What draws `page`: a plugin's own component, or the built-in one. */
export function pageComponent(
  page: SettingsPageDef,
): ComponentType<SettingsPageProps> {
  return page.Page ?? BUILT_IN[page.id] ?? (() => null);
}
