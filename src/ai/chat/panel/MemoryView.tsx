import { useMemo, useState } from "react";
import type { AgentWorkspaceInfo, LibraryEntry } from "../../../platform/ipc";
import type { Lang, Strings } from "../../../i18n/strings";
import { listFromWorkspace, pickerSkills } from "../skill-picker";
import "./MemoryView.css";

/**
 * What Textus AI keeps for a project, in one place (the AI panel's Memory
 * tab): the style profile it learned from the writer's own pages, the
 * library of people, places and terms, the writing instructions it always
 * follows, and the skills a slash away. Each is the project's own file
 * (.textus/), so Edit opens it as a document - nothing here is a second
 * copy to keep in step.
 *
 * Library entries the open document mentions are marked: those are the ones
 * the AI is given with this document (ai::project includes an entry when
 * its name or an alias appears, unless set otherwise).
 */
export function MemorySections({
  info,
  t,
  lang,
  documentText,
  onOpenStyle,
  onLearnStyle,
  onNewEntry,
  onOpenEntry,
  onOpenInstructions,
  onOpenGlobalInstructions,
  onConvertLevis,
}: {
  info: AgentWorkspaceInfo;
  t: Strings;
  lang: Lang;
  documentText: string;
  onOpenStyle: () => void;
  onLearnStyle: () => void;
  onNewEntry: () => void;
  onOpenEntry: (entry: LibraryEntry) => void;
  onOpenInstructions: () => void;
  onOpenGlobalInstructions: () => void;
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

  return (
    <div className="memory-sections">
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
              // An entry with nothing in it yet isn't sent anywhere.
              const used =
                entry.body.trim() !== "" &&
                (entry.include === "always" ||
                  (entry.include !== "never" &&
                    [entry.name, ...entry.aliases].some(
                      (name) => name && documentText.includes(name),
                    )));
              return (
                <button
                  type="button"
                  key={entry.file}
                  className={`memory-entry${used ? " memory-entry-used" : ""}`}
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
                  {used && (
                    <span className="memory-used">
                      {t.memoryInThisDocument}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="memory-empty">
            <p>{t.memoryLibraryEmpty}</p>
          </div>
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
