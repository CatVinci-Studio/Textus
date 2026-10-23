import { useState } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { PluginsPage } from "./PluginsPage";
import { ThemeLibrarySection } from "../sections/theme";
import { AgentSkillsSection, BuiltinSkillsSection } from "../sections/skills";
import { McpSection } from "../sections/mcp";
import { LinkRow } from "../sections/controls";
import { MarketPage, type MarketKind } from "./MarketPage";

import {
  extensionsStartTab,
  extensionsTabs,
  openExtensionsTab,
  type ExtensionsTab,
} from "./extensions-tab";

const TABS = extensionsTabs();

/**
 * Settings › Extensions: everything added to Textus, one tab each, every
 * one a card - plugins (the textus-plugins catalog), themes (the theme
 * gallery), skills (the built-ins, five on to start with, and the user's
 * own), and MCP servers. Desktop only, as plugins are.
 */
export function ExtensionsPage(props: SettingsPageProps) {
  const { t, onOpenFile, onFilesDeleted, onClose } = props;
  const [tab, setTabState] = useState<ExtensionsTab>(extensionsStartTab);
  // Get more (MarketPage), opened on a kind; the Plugins tab opens it
  // itself, as it did Get plugins.
  const [market, setMarket] = useState<MarketKind | null>(null);
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
  if (market)
    return <MarketPage t={t} kind={market} onBack={() => setMarket(null)} />;
  const getMore = (kind: MarketKind) => (
    <section className="settings-group">
      <div className="settings-group-body">
        <LinkRow label={t.marketGetMore} onOpen={() => setMarket(kind)} />
      </div>
    </section>
  );
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
      {!props.indexing && (
        <div role="tabpanel" aria-label={label[tab]}>
          {tab === "plugins" && <PluginsPage {...props} />}
          {tab === "themes" && <ThemeLibrarySection t={t} />}
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
              {getMore("skills")}
            </>
          )}
          {tab === "mcp" && <McpSection t={t} />}
        </div>
      )}
    </>
  );
}
