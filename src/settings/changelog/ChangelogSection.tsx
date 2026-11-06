import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { localeOf, type Lang, type Strings } from "../../i18n/strings";
import { lazyModule, type LazyModule } from "../../lazy/lazy-module";
import { renderMarkdownHtml } from "../../editor/markdown/render-html";
import { appVersion } from "../../platform/app-info";
import { links } from "../../platform/ipc";
import {
  notesLanguage,
  type NotesLanguage,
  type ReleaseNote,
} from "./changelog";
import "./Changelog.css";

// Each language's notes are a chunk of their own (~200 KB), loaded when the
// page opens.
const NOTES: Record<NotesLanguage, LazyModule<{ default: ReleaseNote[] }>> = {
  en: lazyModule("changelog:en", () => import("./notes-en")),
  zh: lazyModule("changelog:zh", () => import("./notes-zh")),
  "zh-Hant": lazyModule("changelog:zh-Hant", () => import("./notes-zh-Hant")),
};

/** Settings › General › Release Notes: every version's notes, newest
 *  first, in the user's language where the notes are translated. */
export function ChangelogSection({
  t,
  language,
}: {
  t: Strings;
  language: Lang;
}) {
  const notesIn = notesLanguage(language);
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [installed, setInstalled] = useState("");

  useEffect(() => {
    let live = true;
    setFailed(false);
    NOTES[notesIn]
      .load()
      .then((loaded) => live && setNotes(loaded.default))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [notesIn]);

  useEffect(() => {
    appVersion()
      .then(setInstalled)
      .catch(() => setInstalled(""));
  }, []);

  const dates = useMemo(
    () => new Intl.DateTimeFormat(localeOf(language), { dateStyle: "long" }),
    [language],
  );

  if (failed)
    return <div className="settings-row-hint">{t.changelogLoadFailed}</div>;
  if (!notes) return null;
  return (
    <div className="changelog">
      {/* Japanese, Korean and the rest read the English notes. */}
      {notesIn !== language && (
        <div className="settings-row-hint">{t.changelogInEnglish}</div>
      )}
      {notes.map((note, index) => (
        <ChangelogEntry
          key={note.version}
          note={note}
          // The newest is open: what an update just brought.
          initiallyOpen={index === 0}
          installed={note.version === installed}
          date={note.date ? dates.format(dayOf(note.date)) : ""}
          t={t}
        />
      ))}
    </div>
  );
}

/** "2026-11-05" as that day, wherever the user is. */
const dayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function ChangelogEntry({
  note,
  initiallyOpen,
  installed,
  date,
  t,
}: {
  note: ReleaseNote;
  initiallyOpen: boolean;
  installed: boolean;
  date: string;
  t: Strings;
}) {
  // A version's notes are rendered the first time it opens, not all sixty
  // at once.
  const [opened, setOpened] = useState(initiallyOpen);
  return (
    <details
      className="changelog-entry"
      open={initiallyOpen}
      onToggle={(e) => e.currentTarget.open && setOpened(true)}
    >
      <summary>
        <span className="changelog-version">{note.version}</span>
        {note.prerelease && (
          <span className="changelog-tag">{t.changelogPrerelease}</span>
        )}
        {installed && (
          <span className="changelog-tag changelog-tag-installed">
            {t.changelogInstalled}
          </span>
        )}
        {date && <span className="changelog-date">{date}</span>}
      </summary>
      {opened && <NoteBody markdown={note.body} />}
    </details>
  );
}

function NoteBody({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdownHtml(markdown), [markdown]);
  // A link opens in the browser; followed here it would replace the app.
  const openLink = (e: MouseEvent) => {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/.test(link.href)) void links.openWebLink(link.href);
  };
  return (
    // Safe: renderMarkdownHtml sanitizes, and the notes ship with the app.
    <div
      className="changelog-body"
      onClick={openLink}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
