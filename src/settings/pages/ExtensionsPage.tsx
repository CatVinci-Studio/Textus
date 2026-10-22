import { useState } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { PluginsPage } from "./PluginsPage";
import { SettingRow } from "../sections/controls";
import { ThemeGallerySection } from "../sections/theme-gallery";
import { AgentSkillsSection, BuiltinSkillsSection } from "../sections/skills";
import { McpSection } from "../sections/mcp";

import {
  extensionsStartTab,
  openExtensionsTab,
  type ExtensionsTab,
} from "./extensions-tab";

const TABS: ExtensionsTab[] = ["plugins", "themes", "skills", "mcp"];

/**
 * Settings › Extensions: everything added to Textus, one tab each, every
 * one a card - plugins (the textus-plugins catalog), themes (the theme
 * gallery), skills (the built-ins, five on to start with, and the user's
 * own), and MCP servers. Desktop only, as plugins are.
 */
export function ExtensionsPage(props: SettingsPageProps) {
  const { t, setSubpage, onOpenFile, onFilesDeleted, onClose } = props;
  const [tab, setTabState] = useState<ExtensionsTab>(extensionsStartTab);
  const setTab = (next: ExtensionsTab) => {
    openExtensionsTab(next);
    setTabState(next);
  };
  const label: Record<ExtensionsTab, string> = {
    plugins: t.extensionsTabPlugins,
    themes: t.extensionsTabThemes,
    skills: t.extensionsTabSkills,
    mcp: t.extensionsTabMcp,
  };
  return (
    <>
      <div
        className="auth-tabs extensions-tabs"
        role="tablist"
        aria-label={t.navExtensions}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`auth-tab${tab === id ? " auth-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label[id]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={label[tab]}>
        {tab === "plugins" && <PluginsPage {...props} />}
        {tab === "themes" && (
          <>
            <SettingsGroup title={t.extensionsThemesInstalled}>
              <SettingRow
                label={t.themeMoreLabel}
                hint={t.extensionsThemesManageHint}
              >
                <button
                  type="button"
                  className="text-button settings-inline-button"
                  onClick={() => setSubpage("themes")}
                >
                  {t.extensionsThemesManage}
                </button>
              </SettingRow>
            </SettingsGroup>
            <SettingsGroup title={t.extensionsThemesGet}>
              <ThemeGallerySection t={t} />
            </SettingsGroup>
          </>
        )}
        {tab === "skills" && (
          <>
            <SettingsGroup title={t.extensionsTabSkills}>
              <p className="plugin-group-help">{t.extensionsSkillsHelp}</p>
              <AgentSkillsSection t={t} />
            </SettingsGroup>
            <BuiltinSkillsSection
              t={t}
              open
              onOpenFile={onOpenFile}
              onFilesDeleted={onFilesDeleted}
              onClose={onClose}
            />
          </>
        )}
        {tab === "mcp" && <McpSection t={t} />}
      </div>
    </>
  );
}
