import { useState, type ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import type {
  FigureKind,
  Outline,
  OutlineSection,
} from "../../platform/bindings/ai-paper";
import { Select } from "../../ui/Select";
import {
  addSection,
  editFigures,
  editSection,
  FIGURE_KINDS,
  keyPointsFrom,
  keyPointsText,
  moveSection,
  removeSection,
  totalLength,
} from "./outline-edit";
import "./outline-card.css";

/** The labels of the figure kinds, in the card's selects. */
function kindLabel(t: Strings, kind: FigureKind): string {
  switch (kind) {
    case "mermaid":
      return t.paperFigureMermaid;
    case "chart":
      return t.paperFigureChart;
    case "web":
      return t.paperFigureWeb;
    case "generated":
      return t.paperFigureGenerated;
  }
}

/** Key points shown before "n more". */
const POINTS_SHOWN = 2;

/** A title that numbers itself ("一、", "2.", "III.") needs no number
 *  beside it. */
const NUMBERED = /^\s*([一二三四五六七八九十百]+[、.．]|\d+[.、．)]|[IVXL]+\.)/;

/** What the card is editing: one section, the thesis, or nothing. */
type Editing = number | "thesis" | null;

/**
 * A paper's outline, before any of it is written: the one point where the
 * paper agent waits for the user (docs/design/ai-paper.md). It reads as an
 * outline; Edit opens one part at a time, and Approve hands the edited
 * outline on - nothing is written before it. `unit` names the lengths
 * ("characters" or "words" in the UI language).
 */
export function OutlineCard({
  outline: initial,
  unit,
  busy,
  t,
  onApprove,
}: {
  outline: Outline;
  unit: string;
  /** Approve was pressed and drafting is starting: nothing edits. */
  busy: boolean;
  t: Strings;
  onApprove: (outline: Outline) => void;
}) {
  const [outline, setOutline] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const last = outline.sections.length - 1;
  const untitled = outline.sections.some((s) => !s.title.trim());
  const editButton = (target: Editing, label: string) => (
    <button
      type="button"
      className="paper-outline-edit"
      aria-label={label}
      disabled={busy}
      onClick={() => setEditing(target)}
    >
      {t.paperOutlineEdit}
    </button>
  );
  const doneButton = (
    <button
      type="button"
      className="inline-chat-action"
      disabled={untitled}
      onClick={() => setEditing(null)}
    >
      {t.paperOutlineDone}
    </button>
  );
  return (
    <section className="paper-outline" aria-label={t.paperOutlineTitle}>
      <header className="paper-outline-head">
        <span className="paper-outline-title">{t.paperOutlineTitle}</span>
        <span className="paper-outline-total">
          {t.paperOutlineTotal
            .replace("{n}", String(totalLength(outline)))
            .replace("{unit}", unit)}
        </span>
      </header>
      {editing === "thesis" && !busy ? (
        <div className="paper-outline-editor">
          <label className="paper-outline-field">
            <span>{t.paperOutlineThesis}</span>
            <textarea
              rows={3}
              autoFocus
              value={outline.thesis}
              onChange={(e) =>
                setOutline({ ...outline, thesis: e.target.value })
              }
            />
          </label>
          <div className="paper-outline-row paper-outline-actions">
            <span className="paper-card-spacer" />
            {doneButton}
          </div>
        </div>
      ) : (
        <div className="paper-outline-thesis">
          <p>{outline.thesis}</p>
          {editButton(
            "thesis",
            `${t.paperOutlineEdit}: ${t.paperOutlineThesis}`,
          )}
        </div>
      )}
      <ol className="paper-outline-sections">
        {outline.sections.map((section, i) =>
          editing === i && !busy ? (
            <li key={i} className="paper-outline-section paper-outline-editor">
              <SectionEditor
                outline={outline}
                index={i}
                t={t}
                onChange={setOutline}
              />
              <div className="paper-outline-row paper-outline-actions">
                <button
                  type="button"
                  className="inline-chat-action"
                  disabled={i === 0}
                  onClick={() => {
                    setOutline(moveSection(outline, i, -1));
                    setEditing(i - 1);
                  }}
                >
                  {t.paperOutlineMoveUp}
                </button>
                <button
                  type="button"
                  className="inline-chat-action"
                  disabled={i === last}
                  onClick={() => {
                    setOutline(moveSection(outline, i, 1));
                    setEditing(i + 1);
                  }}
                >
                  {t.paperOutlineMoveDown}
                </button>
                <button
                  type="button"
                  className="inline-chat-action"
                  disabled={last === 0}
                  onClick={() => {
                    setOutline(removeSection(outline, i));
                    setEditing(null);
                  }}
                >
                  {t.paperOutlineRemoveSection}
                </button>
                <span className="paper-card-spacer" />
                {doneButton}
              </div>
            </li>
          ) : (
            <li key={i} className="paper-outline-section">
              <SectionView
                section={section}
                index={i}
                unit={unit}
                t={t}
                edit={editButton(i, `${t.paperOutlineEdit}: ${section.title}`)}
              />
            </li>
          ),
        )}
      </ol>
      <footer className="paper-outline-foot">
        <button
          type="button"
          className="paper-outline-edit"
          disabled={busy}
          onClick={() => {
            setOutline(addSection(outline, last, t.paperOutlineNewSection));
            setEditing(last + 1);
          }}
        >
          + {t.paperOutlineAddSection}
        </button>
        <span className="paper-card-spacer" />
        <button
          type="button"
          className="inline-chat-action inline-chat-action-primary"
          disabled={busy || untitled}
          onClick={() => {
            setEditing(null);
            onApprove(outline);
          }}
        >
          {busy ? t.paperOutlineApproving : t.paperOutlineApprove}
        </button>
      </footer>
    </section>
  );
}

/** A section as the outline reads: its title and length, its first key
 *  points, and its figures as small tags. */
function SectionView({
  section,
  index,
  unit,
  t,
  edit,
}: {
  section: OutlineSection;
  index: number;
  unit: string;
  t: Strings;
  edit: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hidden = section.keyPoints.length - POINTS_SHOWN;
  const points = open
    ? section.keyPoints
    : section.keyPoints.slice(0, POINTS_SHOWN);
  return (
    <>
      <div className="paper-outline-row">
        {!NUMBERED.test(section.title) && (
          <span className="paper-outline-num" aria-hidden="true">
            {index + 1}
          </span>
        )}
        <span className="paper-outline-heading">{section.title}</span>
        <span className="paper-outline-words">
          {section.targetWords} {unit}
        </span>
        {edit}
      </div>
      {points.length > 0 && (
        <ul className="paper-outline-points" data-open={open || undefined}>
          {points.map((point, p) => (
            <li key={p}>{point}</li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="paper-outline-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open
            ? t.paperOutlineLess
            : t.paperOutlineMore.replace("{n}", String(hidden))}
        </button>
      )}
      {section.figures.length > 0 && (
        <div className="paper-outline-figures">
          {section.figures.map((figure, f) => (
            <span key={f} className="paper-outline-tag" title={figure.spec}>
              <b>{kindLabel(t, figure.kind)}</b> {figure.spec}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** One section's fields: its title, length, key points and figures. */
function SectionEditor({
  outline,
  index: i,
  t,
  onChange,
}: {
  outline: Outline;
  index: number;
  t: Strings;
  onChange: (outline: Outline) => void;
}) {
  const section = outline.sections[i];
  const figures = (change: Parameters<typeof editFigures>[2]) =>
    onChange(editFigures(outline, i, change));
  return (
    <>
      <div className="paper-outline-row">
        <input
          className="paper-outline-section-title"
          autoFocus
          aria-label={t.paperOutlineSectionTitle.replace("{n}", String(i + 1))}
          value={section.title}
          onChange={(e) =>
            onChange(editSection(outline, i, { title: e.target.value }))
          }
        />
        <input
          className="paper-outline-length"
          type="number"
          min={0}
          step={100}
          aria-label={t.paperOutlineLength}
          value={section.targetWords}
          onChange={(e) =>
            onChange(
              editSection(outline, i, {
                targetWords: Math.max(0, Number(e.target.value) || 0),
              }),
            )
          }
        />
      </div>
      <textarea
        className="paper-outline-points-input"
        rows={Math.min(8, Math.max(3, section.keyPoints.length + 1))}
        aria-label={t.paperOutlineKeyPoints}
        placeholder={t.paperOutlineKeyPoints}
        value={keyPointsText(section.keyPoints)}
        onChange={(e) =>
          onChange(
            editSection(outline, i, {
              keyPoints: keyPointsFrom(e.target.value),
            }),
          )
        }
      />
      {section.figures.map((figure, f) => (
        <div key={f} className="paper-outline-row paper-outline-figure">
          <Select
            className="paper-outline-kind"
            aria-label={t.paperOutlineFigureKind}
            value={figure.kind}
            onChange={(e) =>
              figures((all) =>
                all.map((x, j) =>
                  j === f ? { ...x, kind: e.target.value as FigureKind } : x,
                ),
              )
            }
          >
            {FIGURE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(t, kind)}
              </option>
            ))}
          </Select>
          <input
            aria-label={t.paperOutlineFigureSpec}
            value={figure.spec}
            onChange={(e) =>
              figures((all) =>
                all.map((x, j) =>
                  j === f ? { ...x, spec: e.target.value } : x,
                ),
              )
            }
          />
          <button
            type="button"
            className="inline-chat-action"
            onClick={() => figures((all) => all.filter((_, j) => j !== f))}
          >
            {t.paperOutlineRemoveFigure}
          </button>
        </div>
      ))}
      <div className="paper-outline-row">
        <button
          type="button"
          className="paper-outline-edit"
          onClick={() =>
            figures((all) => [...all, { kind: "mermaid", spec: "" }])
          }
        >
          + {t.paperOutlineAddFigure}
        </button>
      </div>
    </>
  );
}
