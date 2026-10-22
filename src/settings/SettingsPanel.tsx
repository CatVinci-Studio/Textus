import { AboutSection } from "./sections/about";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSettings } from "./SettingsContext";
import { useMarginAvailable } from "../ai/margin/margin-room";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { localeOf } from "../i18n/strings";
import type { FixedShortcutGroup } from "../app/fixed-shortcuts";
import { ChevronIcon, CloseIcon } from "../ui/icons";
import { MoreThemesSection } from "./sections/theme";
import { ThemeGallerySection } from "./sections/theme-gallery";
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
import type { SettingsPageProps, Subpage } from "./pages/types";
import { useModalDialog } from "../ui/useModalDialog";
import { usePresenceProps } from "../ui/usePresence";
import { emitMenuEvent } from "../platform/menu-events";
import type { MenuChecks } from "../app/app-menu-model";
import { isIOSApp } from "../platform/capabilities";

// The settings dialog shell: the pages' navigation (settings-pages.tsx),
// the search over them, and the subpages. Each page is its own component in
// pages/; anything with its own state or backend round-trips lives in
// sections/.
//
// One panel for every platform. Each row is a name and a control
// (SettingRow); explanations are kept to the few rows that need one. On a
// phone the same panel fills the screen with the categories as a row of
// tabs along the top (mobile/styles/settings.css) - layout only, no second
// set of pages to keep in step.

interface SettingsPanelProps {
  onClose: () => void;
  /** Opens a document in the editor - the agent.md "edit" button uses it. */
  onOpenFile: (path: string) => void;
  /** Files a settings action deleted (Reset on a customized skill), for
   *  the editor to close their tabs. */
  onFilesDeleted?: (paths: string[]) => void;
  /** Which of the window's view modes are on, for Editor > View. */
  viewChecks?: Pick<MenuChecks, "sourceMode" | "zen">;
  /** The shortcuts that can't be changed, listed under the ones that can
   *  (built from the app menu, app/fixed-shortcuts.ts). */
  fixedShortcuts?: FixedShortcutGroup[];
}

/** A Settings page's id (settings-pages.tsx). */
type Category = string;

/** The page a subpage's back button returns to; none is the category. */
const SUBPAGE_PARENT: Partial<Record<Subpage, Subpage>> = {
  gallery: "themes",
};

/** The subpages the search reads, by the category each is in. Not Browse
 *  themes: its rows are the gallery's themes, fetched only when it opens. */
const SEARCHED_SUBPAGES: [Subpage, Category][] = [
  ["about", "general"],
  ["themes", "editor"],
];

/** A searchable page's key (SearchEntry.page): "editor", "editor/themes". */
const pageKey = (category: Category, subpage: Subpage | null) =>
  subpage ? `${category}/${subpage}` : category;

function pageOfKey(key: string): {
  category: Category;
  subpage: Subpage | null;
} {
  const [category, subpage] = key.split("/");
  return {
    category: category as Category,
    subpage: (subpage as Subpage | undefined) ?? null,
  };
}

export function SettingsPanel({
  onClose,
  onOpenFile,
  onFilesDeleted,
  viewChecks = {},
  fixedShortcuts = [],
}: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
  // As in the review bar: a phone never has a margin, so there is nothing
  // to explain there.
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
  // Rendered inside a Presence (App.tsx): it goes the way it came.
  const presence = usePresenceProps<HTMLDivElement>();
  const { category, setCategory, subpage, setSubpage, content, setJump } =
    useSettingsNav();
  const search = useSettingsSearch();
  const { query, setQuery, searching, setEntries, active, setActive } = search;
  const { matches, searchInput, listId } = search;

  // The guides open as documents, behind this panel - so it gives way.
  const openHelp = (doc: "markdown" | "agent") => {
    onClose();
    emitMenuEvent(`help-doc:${doc}`);
  };

  // The pages, in navigation order, from the one list (settings-pages.tsx).
  const categories = settingsPages().map((page) => ({
    id: page.id,
    label: page.label(t),
  }));

  const subpageTitles: Record<Subpage, string> = {
    about: t.navAbout,
    themes: t.themeMoreLabel,
    gallery: t.themeGalleryBrowse,
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
    openHelp,
    onOpenFile,
    onFilesDeleted,
    onClose,
    viewChecks,
    fixedShortcuts,
  };
  const renderCategory = (c: Category) => {
    const page = settingsPage(c);
    return page ? <page.Page {...pageProps} /> : null;
  };

  const renderSubpage = (s: Subpage) =>
    s === "about" ? (
      <AboutSection t={t} lang={settings.language} />
    ) : (
      <>
        <h1 className="settings-category-title">{subpageTitles[s]}</h1>
        {s === "themes" ? (
          <MoreThemesSection t={t} onBrowse={() => setSubpage("gallery")} />
        ) : (
          <ThemeGallerySection t={t} />
        )}
      </>
    );

  // Each category, with the subpages it holds after it - the order the
  // results are listed in.
  const searchPages: SearchablePage[] = categories.flatMap((c) => [
    { key: c.id, name: c.label, render: () => renderCategory(c.id) },
    ...SEARCHED_SUBPAGES.filter(([, under]) => under === c.id).map(([s]) => ({
      key: pageKey(c.id, s),
      name: `${c.label} › ${subpageTitles[s]}`,
      render: () => renderSubpage(s),
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
    setQuery("");
    setCategory(page.category);
    setSubpage(page.subpage);
    setJump(match.entry);
  };

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
          <span>{t.settingsTitle}</span>
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

        <div className="settings-layout">
          <div className="settings-sidebar">
            <SettingsSearchField
              t={t}
              inputRef={searchInput}
              query={query}
              listId={listId}
              activeId={flatMatches.length ? optionId(activeIndex) : undefined}
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
            <nav className="settings-nav">
              {categories.map((c) => (
                <button
                  key={c.id}
                  aria-current={
                    !searching && category === c.id ? "page" : undefined
                  }
                  data-label={c.label}
                  className={`settings-nav-item ${!searching && category === c.id ? "settings-nav-item-active" : ""}`}
                  onClick={(e) => {
                    setQuery("");
                    setCategory(c.id);
                    setSubpage(null);
                    // On a phone the tabs are one row that scrolls sideways;
                    // in a long language the chosen one can be half out of
                    // view.
                    e.currentTarget.scrollIntoView?.({
                      block: "nearest",
                      inline: "nearest",
                    });
                  }}
                >
                  {c.label}
                </button>
              ))}
            </nav>
          </div>

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
          ) : subpage ? (
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
                onClick={() => setSubpage(SUBPAGE_PARENT[subpage] ?? null)}
              >
                <ChevronIcon className="settings-back-chevron" />
                {SUBPAGE_PARENT[subpage]
                  ? subpageTitles[SUBPAGE_PARENT[subpage]]
                  : categories.find((c) => c.id === category)?.label}
              </button>
              {renderSubpage(subpage)}
            </div>
          ) : (
            <div
              ref={content}
              className="settings-content"
              key={category}
              role="region"
              aria-label={categories.find((c) => c.id === category)?.label}
            >
              <h1 className="settings-category-title">
                {categories.find((c) => c.id === category)?.label}
              </h1>
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

/** Which page Settings shows: a category, and a page of its own inside it
 *  with a way back, on the desktop and the phone alike: General › About
 *  Textus, Editor & Appearance › More themes (› Browse themes). A search
 *  result picked sets `jump`: once the row's page is on screen, it goes to
 *  the row. */
function useSettingsNav() {
  const [category, setCategory] = useState<Category>("general");
  const [subpage, setSubpage] = useState<Subpage | null>(null);
  const [jump, setJump] = useState<SearchEntry | null>(null);
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

  return { category, setCategory, subpage, setSubpage, content, setJump };
}

/** The search box (SettingsSearch.tsx): while it holds a query, its
 *  results stand in for the page, and picking one opens the row's page and
 *  goes to the row. */
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
  // Ctrl/⌘+F finds in Settings while it is open, not in the document
  // behind it - from the keyboard here, or from Edit › Find on a Mac,
  // whose menu takes the keys before the page sees them.
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
