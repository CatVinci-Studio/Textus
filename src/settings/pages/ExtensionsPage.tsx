import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { PluginsPage } from "./PluginsPage";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { ThemesTab } from "../sections/theme";
import {
  BuiltinSkillsSection,
  OwnSkillsList,
  importSkill,
} from "../sections/skills";
import { McpSection } from "../sections/mcp";
import { AvailableSkills } from "../sections/market-skills";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
} from "../../plugins/store/catalog";

import {
  extensionsStartTab,
  extensionsTabs,
  openExtensionsTab,
  type ExtensionsTab,
} from "./extensions-tab";
import { explainError } from "../../utils/error-explain";

const TABS = extensionsTabs();

/**
 * Settings › Extensions: themes, plugins, skills and MCP servers, a tab
 * each, all laid out alike: what is installed, then what is available.
 * Desktop only, as plugins are.
 */
export function ExtensionsPage(props: SettingsPageProps) {
  const { t, onOpenFile, onFilesDeleted, onClose } = props;
  const [tab, setTabState] = useState<ExtensionsTab>(extensionsStartTab);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  useEffect(() => {
    void loadCatalog();
  }, []);
  const setTab = (next: ExtensionsTab) => {
    openExtensionsTab(next);
    setTabState(next);
  };
  const label: Record<ExtensionsTab, string> = {
    themes: t.extensionsTabThemes,
    plugins: t.extensionsTabPlugins,
    skills: t.extensionsTabSkills,
    mcp: t.extensionsTabMcp,
  };
  const skillProps = { t, onOpenFile, onFilesDeleted, onClose };
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
          {tab === "themes" && <ThemesTab t={t} />}
          {tab === "plugins" && <PluginsPage {...props} />}
          {tab === "skills" && (
            <ExtensionsTabLayout
              t={t}
              intro={t.extensionsIntroSkills}
              help={t.extensionsSkillsHelp}
              query={skillQuery}
              onQuery={setSkillQuery}
              actions={[
                {
                  label: t.agentSkillsImport,
                  onSelect: () =>
                    void importSkill().then(
                      () => setSkillError(null),
                      (err: unknown) => setSkillError(explainError(err, t)),
                    ),
                },
              ]}
              error={skillError}
              installedTitle={t.pluginsInstalledGroup}
              installed={
                <>
                  <OwnSkillsList t={t} query={skillQuery} />
                  <BuiltinSkillsSection
                    {...skillProps}
                    query={skillQuery}
                    flat
                  />
                </>
              }
              available={
                <AvailableSkills t={t} catalog={catalog} query={skillQuery} />
              }
            />
          )}
          {tab === "mcp" && <McpSection t={t} />}
        </div>
      )}
    </>
  );
}
