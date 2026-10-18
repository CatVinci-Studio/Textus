import { useMemo, useState } from "react";
import type {
  AgentWorkspaceInfo,
  LibraryEntry,
  LibraryUse,
  Memory,
  MemoryScope,
  Remembered,
} from "../../../platform/ipc";
import { localeOf, type Lang, type Strings } from "../../../i18n/strings";
import { basename } from "../../../utils/path";
import { listFromWorkspace, pickerSkills } from "../skill-picker";
import "./MemoryView.css";

/**
 * What Textus AI keeps for a project, in one place (the AI panel's Memory
 * tab): what it remembered by itself (ai::memory - personal and the
 * project's), the style profile it learned from the writer's own pages,
 * the library of people, places and terms, the writing instructions it
 * always follows, and the skills a slash away. Each is a file of its own,
 * so Edit opens it as a document - nothing here is a second copy to keep in
 * step.
 *
 * Library entries the AI was given are marked - by Rust, which picked them
 * (`libraryUse`): those the last request carried, or before one, those the
 * open document's text brings in by itself.
 */
export function MemorySections({
  info,
  t,
  lang,
  libraryUse,
  onOpenStyle,
  onLearnStyle,
  onNewEntry,
  onOpenEntry,
  onOpenInstructions,
  onOpenGlobalInstructions,
  onOpenFile,
  onDeleteMemory,
  onMoveMemory,
  onDeleteEntry,
  onConvertLevis,
}: {
  info: AgentWorkspaceInfo;
  t: Strings;
  lang: Lang;
  libraryUse: LibraryUse | null;
  onOpenStyle: () => void;
  onLearnStyle: () => void;
  onNewEntry: () => void;
  onOpenEntry: (entry: LibraryEntry) => void;
  onOpenInstructions: () => void;
  onOpenGlobalInstructions: () => void;
  onOpenFile: (path: string) => void;
  onDeleteMemory: (memory: Memory) => void;
  onMoveMemory: (memory: Memory, scope: MemoryScope) => void;
  onDeleteEntry: (entry: LibraryEntry) => void;
  onConvertLevis: () => void;
}) {
  const styleLines = useMemo(() => styleSummary(info.style), [info.style]);
  const projectRules = useMemo(
    () => ruleLines(info.project_instructions ?? ""),
    [info.project_instructions],
  );
  const globalRules = info.instructions.flatMap(ruleLines);
  const [allSkills, setAllSkills] = useState(false);
  const skills = useMemo(
    () => pickerSkills(listFromWorkspace(info.skills), lang),
    [info.skills, lang],
  );
  const used = new Set(libraryUse?.included ?? []);
  const leftOut = info.library.filter((entry) =>
    libraryUse?.leftOut.includes(entry.file),
  );

  return (
    <div className="memory-sections">
      <RememberedSection
        info={info}
        t={t}
        lang={lang}
        onOpenFile={onOpenFile}
        onOpenEntry={onOpenEntry}
        onDeleteMemory={onDeleteMemory}
        onMoveMemory={onMoveMemory}
        onDeleteEntry={onDeleteEntry}
      />

      <section className="memory-section">
        <h4>
          {t.memoryStyle}
          <span className="memory-file">.textus/style.md</span>
          {info.style && (
            <button type="button" onClick={onOpenStyle}>
              {t.memoryEdit}
            </button>
          )}
        </h4>
        {styleLines.length > 0 ? (
          <ul className="memory-card memory-lines">
            {styleLines.map((line, i) => (
              <li key={i} style={{ "--i": i } as React.CSSProperties}>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <div className="memory-empty">
            <p>{t.memoryStyleEmpty}</p>
            <div className="memory-empty-actions">
              <button type="button" className="primary" onClick={onLearnStyle}>
                {t.projectLearnStyle}
              </button>
              <button type="button" onClick={onOpenStyle}>
                {t.projectCreateStyle}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="memory-section">
        <h4>
          {t.memoryLibrary}
          {info.library.length > 0 && (
            <span className="memory-count">{info.library.length}</span>
          )}
          <button type="button" onClick={onNewEntry}>
            {t.memoryNew}
          </button>
        </h4>
        {info.library.length > 0 ? (
          <div className="memory-library">
            {info.library.map((entry) => {
              const sent = used.has(entry.file);
              return (
                <div
                  key={entry.file}
                  className={`memory-entry${sent ? " memory-entry-used" : ""}`}
                >
                  <button
                    type="button"
                    className="memory-entry-open"
                    onClick={() => onOpenEntry(entry)}
                  >
                    <b>{entry.name}</b>
                    {entry.aliases.length > 0 && (
                      <span className="memory-aliases">
                        {entry.aliases.slice(0, 3).map((a) => (
                          <span key={a}>{a}</span>
                        ))}
                      </span>
                    )}
                    <span className="memory-desc">{firstLine(entry.body)}</span>
                    {sent && (
                      <span className="memory-used">
                        {libraryUse?.lastRequest
                          ? t.memoryUsedInConversation
                          : t.memoryInThisDocument}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="memory-entry-delete"
                    aria-label={`${t.memoryDelete} ${entry.name}`}
                    title={t.memoryDelete}
                    onClick={() => onDeleteEntry(entry)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="memory-empty">
            <p>{t.memoryLibraryEmpty}</p>
          </div>
        )}
        {leftOut.length > 0 && (
          <p className="memory-note" role="note">
            {t.memoryLibraryLeftOut
              .replace("{names}", leftOut.map((e) => e.name).join(", "))
              .replace(
                "{cap}",
                (libraryUse?.cap ?? 0).toLocaleString(localeOf(lang)),
              )}
          </p>
        )}
      </section>

      <section className="memory-section">
        <h4>
          {t.memoryInstructions}
          <button type="button" onClick={onOpenInstructions}>
            {t.memoryEdit}
          </button>
        </h4>
        {projectRules.length > 0 || globalRules.length > 0 ? (
          <ul className="memory-card memory-lines">
            {projectRules.map((line, i) => (
              <li key={`p${i}`}>{line}</li>
            ))}
            {globalRules.map((line, i) => (
              <li key={`g${i}`} className="memory-global">
                {line}
                <span className="memory-scope">{t.memoryAllProjects}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="memory-empty">
            <p>{t.memoryInstructionsEmpty}</p>
          </div>
        )}
        <button
          type="button"
          className="memory-link"
          onClick={onOpenGlobalInstructions}
        >
          {t.memoryEditGlobal}
        </button>
      </section>

      {skills.length > 0 && (
        <section className="memory-section">
          <h4>{t.memorySkills}</h4>
          <div className="memory-skills">
            {(allSkills ? skills : skills.slice(0, SKILLS_SHOWN)).map(
              (skill) => (
                <span key={skill.name} title={skill.hint}>
                  /{skill.label ?? skill.name}
                </span>
              ),
            )}
            {!allSkills && skills.length > SKILLS_SHOWN && (
              <button
                type="button"
                className="memory-more"
                onClick={() => setAllSkills(true)}
              >
                +{skills.length - SKILLS_SHOWN}
              </button>
            )}
          </div>
        </section>
      )}

      {info.levis_project && (
        <button type="button" className="memory-link" onClick={onConvertLevis}>
          {t.memoryConvertLevis}
        </button>
      )}
    </div>
  );
}

/** From this share of the memory budget on, the tab says how much is used. */
const NEAR_CAP = 0.8;

/**
 * "AI remembered": what Textus AI kept with its remember tool - personal
 * memories, then the project's, then the library entries it wrote - each
 * with its date and the conversation it came from, and Edit, Move and
 * Delete. Says so when the memories near or pass the prompt's budget,
 * rather than letting the oldest drop out unseen.
 */
export function RememberedSection({
  info,
  t,
  lang,
  onOpenFile,
  onOpenEntry,
  onDeleteMemory,
  onMoveMemory,
  onDeleteEntry,
}: {
  info: AgentWorkspaceInfo;
  t: Strings;
  lang: Lang;
  onOpenFile: (path: string) => void;
  onOpenEntry: (entry: LibraryEntry) => void;
  onDeleteMemory: (memory: Memory) => void;
  onMoveMemory: (memory: Memory, scope: MemoryScope) => void;
  onDeleteEntry: (entry: LibraryEntry) => void;
}) {
  const { items, chars, cap } = info.memories;
  const facts = info.library.flatMap((entry) =>
    entry.remembered ? [{ entry, remembered: entry.remembered }] : [],
  );
  const groups: { scope: MemoryScope; title: string; items: Memory[] }[] = [
    {
      scope: "personal",
      title: t.memoryRememberedPersonal,
      items: items.filter((m) => m.scope === "personal"),
    },
    {
      scope: "project",
      title: t.memoryRememberedProject,
      items: items.filter((m) => m.scope === "project"),
    },
  ];
  const notSent = items.filter((m) => !m.included).length;
  const number = (n: number) => n.toLocaleString(localeOf(lang));
  const note =
    notSent > 0
      ? t.memoryOverCap
          .replace("{n}", number(notSent))
          .replace("{cap}", number(cap))
      : chars >= cap * NEAR_CAP
        ? t.memoryNearCap
            .replace("{used}", number(chars))
            .replace("{cap}", number(cap))
        : null;

  return (
    <section className="memory-section memory-remembered">
      <h4>
        {t.memoryRemembered}
        {items.length + facts.length > 0 && (
          <span className="memory-count">{items.length + facts.length}</span>
        )}
      </h4>
      {items.length + facts.length === 0 ? (
        <div className="memory-empty">
          <p>{info.remember ? t.memoryRememberedEmpty : t.memoryRememberOff}</p>
        </div>
      ) : (
        <>
          {!info.remember && (
            <p className="memory-note">{t.memoryRememberOff}</p>
          )}
          {groups.map((group) => {
            const groupFacts = group.scope === "project" ? facts : [];
            if (group.items.length + groupFacts.length === 0) return null;
            return (
              <div key={group.scope} className="memory-remembered-group">
                <h5>{group.title}</h5>
                <ul className="memory-card memory-remembered-list">
                  {group.items.map((memory) => (
                    <RememberedItem
                      key={memory.id}
                      text={memory.text}
                      kind={t[KIND_LABEL[memory.kind]]}
                      remembered={memory.remembered}
                      notSent={!memory.included}
                      t={t}
                      lang={lang}
                      onEdit={() => onOpenFile(memory.file)}
                      moveLabel={
                        memory.scope === "project"
                          ? t.memoryMakePersonal
                          : info.root
                            ? t.memoryMakeProject
                            : null
                      }
                      onMove={() =>
                        onMoveMemory(
                          memory,
                          memory.scope === "project" ? "personal" : "project",
                        )
                      }
                      onDelete={() => onDeleteMemory(memory)}
                    />
                  ))}
                  {groupFacts.map(({ entry, remembered }) => (
                    <RememberedItem
                      key={entry.file}
                      text={`${entry.name}: ${firstLine(entry.body)}`}
                      kind={t.memoryKindFact}
                      remembered={remembered}
                      notSent={false}
                      t={t}
                      lang={lang}
                      onEdit={() => onOpenEntry(entry)}
                      moveLabel={null}
                      onMove={() => {}}
                      onDelete={() => onDeleteEntry(entry)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
      {note && (
        <p className="memory-note" role="note">
          {note}
        </p>
      )}
    </section>
  );
}

const KIND_LABEL = {
  requirement: "memoryKindRequirement",
  preference: "memoryKindPreference",
  style: "memoryKindStyle",
} as const satisfies Record<Memory["kind"], keyof Strings>;

function RememberedItem({
  text,
  kind,
  remembered,
  notSent,
  t,
  lang,
  onEdit,
  moveLabel,
  onMove,
  onDelete,
}: {
  text: string;
  kind: string;
  remembered: Remembered;
  notSent: boolean;
  t: Strings;
  lang: Lang;
  onEdit: () => void;
  /** Null: it can't move (a fact; no project to move to). */
  moveLabel: string | null;
  onMove: () => void;
  onDelete: () => void;
}) {
  const from = remembered.title || basename(remembered.document ?? "");
  const meta = [
    kind,
    rememberedDate(remembered.updated, lang),
    from ? t.memoryFrom.replace("{title}", from) : "",
  ].filter(Boolean);
  return (
    <li className={notSent ? "memory-not-sent" : undefined}>
      <div className="memory-remembered-text">{text}</div>
      <div className="memory-remembered-meta">
        {meta.join(" · ")}
        {notSent && <span className="memory-badge">{t.memoryNotSent}</span>}
      </div>
      <div className="memory-remembered-actions">
        <button type="button" onClick={onEdit}>
          {t.memoryEdit}
        </button>
        {moveLabel && (
          <button type="button" onClick={onMove}>
            {moveLabel}
          </button>
        )}
        <button type="button" onClick={onDelete}>
          {t.memoryDelete}
        </button>
      </div>
    </li>
  );
}

/** "Oct 18, 2026" from the record's `2026-10-18T09:30:00Z`, in the UI's
 *  language; "" when there is none. */
export function rememberedDate(stamp: string, lang: Lang): string {
  const date = new Date(stamp);
  if (!stamp || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(localeOf(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A library entry's id for the memory commands (ai::memory): its file
 *  `.textus/library/<stem>.md` as `project/library/<stem>`. */
export function libraryEntryId(entry: LibraryEntry): string {
  return `project/library/${basename(entry.file).replace(/\.md$/, "")}`;
}

/** Skills shown before "+N" - the slash menu is where they are used. */
const SKILLS_SHOWN = 8;

/** The style profile's points, for a glance: its list items and plain
 *  lines, without the front matter, headings or comments. */
export function styleSummary(style: string | null): string[] {
  if (!style) return [];
  const body = style.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ""))
    .filter(Boolean)
    .slice(0, 6);
}

function ruleLines(text: string): string[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ""))
    .slice(0, 8);
}

function firstLine(body: string): string {
  return (
    body
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#")) ?? ""
  );
}
