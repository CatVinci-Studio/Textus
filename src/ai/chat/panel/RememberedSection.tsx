import type {
  AgentWorkspaceInfo,
  Memory,
  MemoryScope,
  Remembered,
} from "../../../platform/ipc";
import { localeOf, type Lang, type Strings } from "../../../i18n/strings";
import { basename } from "../../../utils/path";
import "./MemoryView.css";

import {
  rememberedDate,
  FORGOTTEN_SHOWN,
  matches,
  firstLine,
  NEAR_CAP,
} from "./memory-text";
/** Memory › Remembered: what Textus AI keeps about the user and the project, each item to read, change or forget. */

/**
 * "AI remembered": personal memories, then the project's, each with its date,
 * source and actions. Says so when they near the prompt's budget, rather than
 * letting the oldest drop out unseen.
 */
export function RememberedSection({
  info,
  t,
  lang,
  query = "",
  onOpenFile,
  onRevealFile,
  onRestoreForgotten,
  onDeleteMemory,
  onMoveMemory,
}: {
  info: AgentWorkspaceInfo;
  t: Strings;
  lang: Lang;
  /** The Memory tab's search: only the memories that contain it. */
  query?: string;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onRestoreForgotten: (id: string) => void;
  onDeleteMemory: (memory: Memory) => void;
  onMoveMemory: (memory: Memory, scope: MemoryScope) => void;
}) {
  const { items: all, chars, cap } = info.memories;
  const forgotten = (info.memories.forgotten ?? []).slice(0, FORGOTTEN_SHOWN);
  const items = all.filter((m) => matches(query, m.text));
  const facts = info.library.filter((entry) => entry.remembered).length;
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
  const notSent = all.filter((m) => !m.included).length;
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
        {all.length > 0 && <span className="memory-count">{all.length}</span>}
      </h4>
      <p className="memory-hint">{t.memoryRememberedHint}</p>
      {all.length === 0 ? (
        <div className="memory-empty">
          <p>{info.remember ? t.memoryRememberedEmpty : t.memoryRememberOff}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="memory-empty">
          <p>{t.memoryNoMatch}</p>
        </div>
      ) : (
        <>
          {!info.remember && (
            <p className="memory-note">{t.memoryRememberOff}</p>
          )}
          {groups.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.scope} className="memory-remembered-group">
                <h5>
                  {group.title}
                  <button
                    type="button"
                    className="memory-reveal"
                    onClick={() => onRevealFile(group.items[0].file)}
                  >
                    {t.memoryShowInFolder}
                  </button>
                </h5>
                <ul className="memory-card memory-remembered-list">
                  {group.items.map((memory) => (
                    <RememberedItem
                      key={memory.id}
                      id={memory.id}
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
                </ul>
              </div>
            );
          })}
        </>
      )}
      {forgotten.length > 0 && (
        <details className="memory-forgotten">
          <summary>
            {t.memoryForgotten}
            <span className="memory-count">{forgotten.length}</span>
          </summary>
          <ul className="memory-card memory-remembered-list">
            {forgotten.map((f) => (
              <li key={f.id}>
                <div className="memory-remembered-text">
                  {f.name ? `${f.name}: ${firstLine(f.text)}` : f.text}
                </div>
                <div className="memory-remembered-meta">
                  {rememberedDate(f.forgotten, lang)}
                </div>
                <div className="memory-remembered-actions">
                  <button
                    type="button"
                    onClick={() => onRestoreForgotten(f.id)}
                  >
                    {t.memoryRestore}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {facts > 0 && (
        <p className="memory-note">
          {t.memoryFactsInLibrary.replace("{n}", number(facts))}
        </p>
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
  id,
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
  /** Its id, for a chip in the chat to point at. */
  id: string;
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
    <li className={notSent ? "memory-not-sent" : undefined} data-memory-id={id}>
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
