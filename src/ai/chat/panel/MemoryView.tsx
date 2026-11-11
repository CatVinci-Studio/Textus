import { fill } from "../../../i18n/fill";
import { SearchField } from "../../../engine/controls/SearchField";
import { useMemo, useState } from "react";
import type {
  AgentWorkspaceInfo,
  LibraryEntry,
  LibraryUse,
  Memory,
  MemoryScope,
} from "../../../platform/ipc";
import { localeOf, type Lang, type Strings } from "../../../i18n/strings";
import { Tooltip } from "../../../engine/controls/Tooltip";
import { useMemoryFocus } from "./memory-focus";
import "./MemoryView.css";
import { RememberedSection } from "./RememberedSection";
import {
  rememberedDate,
  SEARCH_FROM,
  matches,
  styleSummary,
  ruleLines,
  firstLine,
  stemOf,
} from "./memory-text";

/**
 * What Textus AI keeps for a project: style, instructions, library, then what
 * it remembered. Each is a file of its own, so Edit opens it as a document.
 * Library entries the AI was given (`libraryUse`, picked by Rust) are marked.
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
  onRevealFile,
  onRestoreForgotten,
  onDeleteMemory,
  onMoveMemory,
  onDeleteEntry,
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
  onRevealFile: (path: string) => void;
  onRestoreForgotten: (id: string) => void;
  onDeleteMemory: (memory: Memory) => void;
  onMoveMemory: (memory: Memory, scope: MemoryScope) => void;
  onDeleteEntry: (entry: LibraryEntry) => void;
}) {
  const styleLines = useMemo(() => styleSummary(info.style), [info.style]);
  const projectRules = useMemo(
    () => ruleLines(info.project_instructions ?? ""),
    [info.project_instructions],
  );
  const globalRules = info.instructions.flatMap(ruleLines);
  const [query, setQuery] = useState("");
  const used = new Set(libraryUse?.included ?? []);
  const leftOut = info.library.filter((entry) =>
    libraryUse?.leftOut.includes(entry.file),
  );
  const library = info.library.filter((entry) =>
    matches(query, entry.name, ...entry.aliases, entry.body),
  );
  const searchable =
    info.memories.items.length + info.library.length >= SEARCH_FROM;

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useMemoryFocus(root);

  return (
    <div className="memory-sections" ref={setRoot}>
      {searchable && (
        <SearchField
          className="memory-search"
          placeholder={t.memorySearch}
          aria-label={t.memorySearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <section className="memory-section">
        <h4>
          {t.memoryStyle}
          {info.style && (
            <button
              type="button"
              title=".textus/style.md"
              onClick={onOpenStyle}
            >
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
          {t.memoryInstructions}
          <button
            type="button"
            title=".textus/agent.md"
            onClick={onOpenInstructions}
          >
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
        {info.library.length > 0 && library.length === 0 ? (
          <div className="memory-empty">
            <p>{t.memoryNoMatch}</p>
          </div>
        ) : info.library.length > 0 ? (
          <div className="memory-library">
            {library.map((entry) => {
              const sent = used.has(entry.file);
              return (
                <div
                  key={entry.file}
                  className={`memory-entry${sent ? " memory-entry-used" : ""}`}
                  data-memory-id={`project/library/${stemOf(entry.file)}`}
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
                    {entry.remembered && (
                      <span className="memory-desc memory-by-ai">
                        {[
                          t.memoryWrittenByAi,
                          rememberedDate(entry.remembered.updated, lang),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    {sent && (
                      <span className="memory-used">
                        {libraryUse?.lastRequest
                          ? t.memoryUsedInConversation
                          : t.memoryInThisDocument}
                      </span>
                    )}
                  </button>
                  <Tooltip text={t.memoryDelete}>
                    <button
                      type="button"
                      className="memory-entry-delete"
                      aria-label={`${t.memoryDelete} ${entry.name}`}
                      onClick={() => onDeleteEntry(entry)}
                    >
                      ×
                    </button>
                  </Tooltip>
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
            {fill(t.memoryLibraryLeftOut, {
              names: leftOut.map((e) => e.name).join(", "),
              cap: (libraryUse?.cap ?? 0).toLocaleString(localeOf(lang)),
            })}
          </p>
        )}
      </section>

      <RememberedSection
        info={info}
        t={t}
        lang={lang}
        query={query}
        onOpenFile={onOpenFile}
        onRevealFile={onRevealFile}
        onRestoreForgotten={onRestoreForgotten}
        onDeleteMemory={onDeleteMemory}
        onMoveMemory={onMoveMemory}
      />
    </div>
  );
}
