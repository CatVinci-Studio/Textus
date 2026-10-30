import { AboutSection } from "./sections/about";
import { GuidesSection } from "./sections/guides";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSettings } from "../prefs/SettingsContext";
import { useMarginAvailable } from "../ai/margin/margin-room";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { localeOf } from "../i18n/strings";
import type { FixedShortcutGroup } from "../app/fixed-shortcuts";
import { ChevronIcon, CloseIcon } from "../ui/icons";
import { ThemesTab } from "./sections/theme";
import { openExtensionsTab, type ExtensionsTab } from "./pages/extensions-tab";
import {
  revealEntry,
  SettingsSearchField,
  SettingsSearchIndex,
  SettingsSearchResults,
  type SearchablePage,
} from "./SettingsSearch";
import {
  findEntryElement,
  matchEntries,
  type SearchEntry,
  type SearchMatch,
} from "./settings-search";
import { comboFromEvent } from "../utils/shortcuts";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import { TOGGLE_FIND_REPLACE_EVENT } from "../utils/events";
import "./SettingsPanel.css";
import { settingsPage, settingsPages } from "./settings-pages";
import type {
  SettingsPageProps,
  ShortcutCommand,
  HelpGuide,
  Subpage,
} from "./pages/types";
import { useModalDialog } from "../ui/useModalDialog";
import { usePresenceProps } from "../ui/usePresence";
import { emitMenuEvent } from "../platform/menu-events";
import { isIOSApp } from "../platform/capabilities";

// The settings dialog shell: navigation, search and subpages, for every
// platform. On a phone the same panel fills the screen as iOS's Settings
// does: a list of the categories, each pushing its page.

export interface SettingsPanelProps {
  onClose: () => void;
  /** Opens a document in the editor, for the agent.md "edit" button. */
  onOpenFile: (path: string) => void;
  /** Files a settings action deleted (Reset on a customized skill), for
   *  the editor to close their tabs. */
  onFilesDeleted?: (paths: string[]) => void;
  /** The shortcuts that can't be changed, listed under the ones that can. */
  fixedShortcuts?: FixedShortcutGroup[];
  /** The commands plugins add, under Shortcuts' own. */
  pluginCommands?: ShortcutCommand[];
  /** The page to open at; General when left out. */
  initialCategory?: string;
}

type Category = string;

/** The subpages the search reads, by the category each is in. */
const SEARCHED_SUBPAGES: [Subpage, Category][] = [
  ["about", "general"],
  ["guides", "general"],
];

/** The Extensions tabs the search reads, each as a page of its own. */
const SEARCHED_TABS: ExtensionsTab[] = ["themes"];

/** A searchable page's key: "editor", "editor/themes",
 *  "extensions/tab:themes". */
const pageKey = (category: Category, subpage: Subpage | null) =>
  subpage ? `${category}/${subpage}` : category;
const tabKey = (tab: ExtensionsTab) => `extensions/tab:${tab}`;

function pageOfKey(key: string): {
  category: Category;
  subpage: Subpage | null;
  tab: ExtensionsTab | null;
} {
  const [category, rest] = key.split("/");
  const tab = rest?.startsWith("tab:")
    ? (rest.slice(4) as ExtensionsTab)
    : null;
  return {
    category: category as Category,
    subpage: tab ? null : ((rest as Subpage | undefined) ?? null),
    tab,
  };
}

export function SettingsPanel({
  onClose,
  onOpenFile,
  onFilesDeleted,
  fixedShortcuts = [],
  pluginCommands = [],
  initialCategory = "general",
}: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
  // A phone never has a margin, so there is nothing to explain there.
  const marginAvailable = useMarginAvailable();
  const phone = usePhoneLayout();
  const noMargin = !phone && !marginAvailable;
  // "125 %" in French, "125%" in English.
  const percent = new Intl.NumberFormat(localeOf(settings.language), {
    style: "percent",
  });
  // Closing Settings on a phone leaves the keyboard down: the user is
  // going back to the page, not necessarily to typing.
  const modal = useModalDialog(onClose, true, undefined, false);
  // Rendered inside a Presence: it goes the way it came.
  const presence = usePresenceProps<HTMLDivElement>();
  const nav = useSettingsNav(initialCategory);
  const { category, subpage, setSubpage, content, setJump } = nav;
  // A phone opened at General starts on the list instead.
  const atHome = phone && nav.home;
  const search = useSettingsSearch();
  const { query, setQuery, searching, setEntries, active, setActive } = search;
  const { matches, searchInput, listId } = search;

  // The guides open as documents, behind this panel - so it gives way.
  const openHelp = (doc: HelpGuide) => {
    onClose();
    emitMenuEvent(`help-doc:${doc}`);
  };

  const categories = settingsPages().map((page) => ({
    id: page.id,
    label: page.label(t),
  }));

  const subpageTitles: Record<Subpage, string> = {
    about: t.navAbout,
    guides: t.navGuides,
  };

  const pageProps: SettingsPageProps = {
    t,
    settings,
    setSettings,
    phone,
    percent,
    marginAvailable,
    noMargin,
    setSubpage,
    openPage: nav.open,
    openHelp,
    onOpenFile,
    onFilesDeleted,
    onClose,
    fixedShortcuts,
    pluginCommands,
  };
  const renderCategory = (c: Category, indexing = false) => {
    const page = settingsPage(c);
    return page ? <page.Page {...pageProps} indexing={indexing} /> : null;
  };
  const tabTitles: Partial<Record<ExtensionsTab, string>> = {
    themes: t.extensionsTabThemes,
  };

  const renderSubpage = (s: Subpage) =>
    s === "about" ? (
      <AboutSection t={t} checkNow={initialCategory === "updates"} />
    ) : (
      <>
        <h1 className="settings-category-title">{subpageTitles[s]}</h1>
        <GuidesSection t={t} language={settings.language} openHelp={openHelp} />
      </>
    );

  // Each category, with the subpages it holds after it.
  const searchPages: SearchablePage[] = categories.flatMap((c) => [
    { key: c.id, name: c.label, render: () => renderCategory(c.id, true) },
    ...SEARCHED_SUBPAGES.filter(([, under]) => under === c.id).map(([s]) => ({
      key: pageKey(c.id, s),
      name: `${c.label} › ${subpageTitles[s]}`,
      render: () => renderSubpage(s),
    })),
    ...(c.id === "extensions" ? SEARCHED_TABS : []).map((tab) => ({
      key: tabKey(tab),
      name: `${c.label} › ${tabTitles[tab]}`,
      // Read for the index only: Get more is never pressed here.
      render: () => <ThemesTab t={t} />,
    })),
  ]);
  const resultGroups = searchPages
    .map((page) => ({
      key: page.key,
      name: page.name,
      matches: matches.filter((m) => m.entry.page === page.key),
    }))
    .filter((group) => group.matches.length > 0);
  const flatMatches = resultGroups.flatMap((group) => group.matches);
  const activeIndex = Math.min(active, Math.max(flatMatches.length - 1, 0));
  const optionId = (index: number) => `${listId}-option-${index}`;

  const pick = (match: SearchMatch | undefined) => {
    if (!match) return;
    const page = pageOfKey(match.entry.page);
    if (page.tab) openExtensionsTab(page.tab);
    setQuery("");
    nav.open(page.category, page.subpage);
    setJump(match.entry);
  };
  const categoryLabel = categories.find((c) => c.id === category)?.label;
  // On a phone the bar names the page and goes back; Done stays.
  const pushed = phone && !atHome && !searching;
  const backLabel = subpage ? categoryLabel : t.settingsTitle;
  // The phone's list leads to pages; it has no current one.
  const current = (id: Category) => !phone && !searching && category === id;

  return (
    <div {...presence} className="settings-backdrop" onClick={onClose}>
      <div
        {...modal}
        role="dialog"
        aria-modal="true"
        aria-label={t.settingsTitle}
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          {pushed && (
            <button
              type="button"
              className="text-button settings-bar-back"
              onClick={nav.back}
            >
              <ChevronIcon className="settings-back-chevron" />
              {backLabel}
            </button>
          )}
          <span>
            {pushed
              ? subpage
                ? subpageTitles[subpage]
                : categoryLabel
              : t.settingsTitle}
          </span>
          {isIOSApp ? (
            // iOS closes a sheet like this with a word, not a cross.
            <button
              className="text-button settings-done-button"
              onClick={onClose}
            >
              {t.settingsDone}
            </button>
          ) : (
            <button
              className="icon-button settings-close-button"
              aria-label={t.windowClose}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="settings-layout" data-nav={nav.direction ?? undefined}>
          {!pushed && (
            <div className="settings-sidebar" key={atHome ? "home" : "side"}>
              <SettingsSearchField
                t={t}
                inputRef={searchInput}
                query={query}
                listId={listId}
                activeId={
                  flatMatches.length ? optionId(activeIndex) : undefined
                }
                onQueryChange={(next) => {
                  setQuery(next);
                  setActive(0);
                }}
                onMove={(step) =>
                  flatMatches.length &&
                  setActive(
                    (activeIndex + step + flatMatches.length) %
                      flatMatches.length,
                  )
                }
                onPick={() => pick(flatMatches[activeIndex])}
              />
              {(!phone || !searching) && (
                <nav className="settings-nav">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      aria-current={current(c.id) ? "page" : undefined}
                      data-label={c.label}
                      className={`settings-nav-item ${current(c.id) ? "settings-nav-item-active" : ""}`}
                      onClick={() => {
                        setQuery("");
                        nav.open(c.id);
                      }}
                    >
                      {c.label}
                      {phone && (
                        <ChevronIcon className="settings-nav-chevron" />
                      )}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          )}

          {searching ? (
            <div
              className="settings-content"
              key="search"
              role="region"
              aria-label={t.settingsSearchResults}
            >
              <SettingsSearchResults
                t={t}
                groups={resultGroups}
                listId={listId}
                optionId={optionId}
                active={activeIndex}
                onPick={pick}
              />
            </div>
          ) : atHome ? null : subpage ? (
            <div
              ref={content}
              className="settings-content"
              key={subpage}
              role="region"
              aria-label={subpageTitles[subpage]}
            >
              <button
                type="button"
                className="text-button settings-back-button"
                onClick={nav.back}
              >
                <ChevronIcon className="settings-back-chevron" />
                {categories.find((c) => c.id === category)?.label}
              </button>
              {renderSubpage(subpage)}
            </div>
          ) : (
            <div
              ref={content}
              className="settings-content"
              key={category}
              role="region"
              aria-label={categoryLabel}
            >
              <h1 className="settings-category-title">{categoryLabel}</h1>
              {renderCategory(category)}
            </div>
          )}
          {searching && (
            <SettingsSearchIndex pages={searchPages} onEntries={setEntries} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Which page Settings shows: a category, and possibly a subpage inside it
 *  with a way back. A picked search result sets `jump` to go to its row.
 *  `home` is the phone's list of categories, which General is opened from;
 *  `direction` says whether the last move went in or back. */
function useSettingsNav(initialCategory: Category) {
  // "updates" is General › About.
  const updates = initialCategory === "updates";
  const [category, setCategory] = useState<Category>(
    updates ? "general" : initialCategory,
  );
  const [subpage, setSubpage] = useState<Subpage | null>(
    updates ? "about" : null,
  );
  const [jump, setJump] = useState<SearchEntry | null>(null);
  const [home, setHome] = useState(initialCategory === "general");
  const [direction, setDirection] = useState<"push" | "pop" | null>(null);
  const content = useRef<HTMLDivElement>(null);

  // Once the row's page is on screen, go to the row. A row that waits on
  // the backend (a status, a list) can come a few frames late.
  useEffect(() => {
    if (!jump) return;
    let frame = 0;
    let tries = 0;
    const go = () => {
      const el = content.current && findEntryElement(content.current, jump);
      if (el) revealEntry(el);
      else if (++tries < 30) {
        frame = requestAnimationFrame(go);
        return;
      }
      setJump(null);
    };
    go();
    return () => cancelAnimationFrame(frame);
  }, [jump]);

  const open = (id: Category, inner: Subpage | null = null) => {
    setCategory(id);
    setSubpage(inner);
    setHome(false);
    setDirection("push");
  };
  const back = () => {
    if (subpage) setSubpage(null);
    else setHome(true);
    setDirection("pop");
  };
  const goSubpage = (inner: Subpage | null) => {
    setSubpage(inner);
    setDirection(inner ? "push" : "pop");
  };

  return {
    category,
    subpage,
    setSubpage: goSubpage,
    content,
    setJump,
    home,
    direction,
    open,
    back,
  };
}

/** The search box: while it holds a query its results stand in for the page,
 *  and picking one goes to the row. */
function useSettingsSearch() {
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const deferredQuery = useDeferredValue(query);
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [active, setActive] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = useMemo(
    () => matchEntries(entries, deferredQuery),
    [entries, deferredQuery],
  );

  const focusSearch = useCallback(() => {
    searchInput.current?.focus();
    searchInput.current?.select();
  }, []);
  // Ctrl/⌘+F finds in Settings while it is open, not in the document behind
  // it; on a Mac the Edit › Find menu takes the keys first.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (comboFromEvent(e) !== "mod+f") return;
      // A shortcut being recorded takes the keys as they are.
      if (
        e.target instanceof Element &&
        e.target.closest(".shortcut-capture-active")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      focusSearch();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusSearch]);
  useWindowEvent(TOGGLE_FIND_REPLACE_EVENT, focusSearch);

  return {
    query,
    setQuery,
    searching,
    setEntries,
    active,
    setActive,
    matches,
    searchInput,
    listId,
  };
}
