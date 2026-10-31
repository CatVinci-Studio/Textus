import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { FigureKind, Outline } from "../../platform/bindings/ai-paper";
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

/**
 * A paper's outline, before any of it is written: the one point where the
 * paper agent waits for the user (docs/design/ai-paper.md). Every part can
 * be changed; Approve hands the edited outline on, and nothing is written
 * before it. `unit` names the lengths ("characters" or "words" in the UI
 * language).
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
  const last = outline.sections.length - 1;
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
      <label className="paper-outline-field">
        <span>{t.paperOutlineThesis}</span>
        <textarea
          rows={2}
          value={outline.thesis}
          disabled={busy}
          onChange={(e) => setOutline({ ...outline, thesis: e.target.value })}
        />
      </label>
      <ol className="paper-outline-sections">
        {outline.sections.map((section, i) => (
          <li key={i} className="paper-outline-section">
            <div className="paper-outline-row">
              <span className="paper-outline-num" aria-hidden="true">
                {i + 1}
              </span>
              <input
                className="paper-outline-section-title"
                aria-label={t.paperOutlineSectionTitle.replace(
                  "{n}",
                  String(i + 1),
                )}
                value={section.title}
                disabled={busy}
                onChange={(e) =>
                  setOutline(editSection(outline, i, { title: e.target.value }))
                }
              />
              <input
                className="paper-outline-length"
                type="number"
                min={0}
                step={100}
                aria-label={t.paperOutlineLength}
                value={section.targetWords}
                disabled={busy}
                onChange={(e) =>
                  setOutline(
                    editSection(outline, i, {
                      targetWords: Math.max(0, Number(e.target.value) || 0),
                    }),
                  )
                }
              />
            </div>
            <textarea
              className="paper-outline-points"
              rows={Math.max(2, section.keyPoints.length)}
              aria-label={t.paperOutlineKeyPoints}
              placeholder={t.paperOutlineKeyPoints}
              value={keyPointsText(section.keyPoints)}
              disabled={busy}
              onChange={(e) =>
                setOutline(
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
                  disabled={busy}
                  onChange={(e) =>
                    setOutline(
                      editFigures(outline, i, (figures) =>
                        figures.map((x, j) =>
                          j === f
                            ? { ...x, kind: e.target.value as FigureKind }
                            : x,
                        ),
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
                  disabled={busy}
                  onChange={(e) =>
                    setOutline(
                      editFigures(outline, i, (figures) =>
                        figures.map((x, j) =>
                          j === f ? { ...x, spec: e.target.value } : x,
                        ),
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="inline-chat-action"
                  disabled={busy}
                  onClick={() =>
                    setOutline(
                      editFigures(outline, i, (figures) =>
                        figures.filter((_, j) => j !== f),
                      ),
                    )
                  }
                >
                  {t.paperOutlineRemoveFigure}
                </button>
              </div>
            ))}
            <div className="paper-outline-row paper-outline-actions">
              <button
                type="button"
                className="inline-chat-action"
                disabled={busy}
                onClick={() =>
                  setOutline(
                    editFigures(outline, i, (figures) => [
                      ...figures,
                      { kind: "mermaid", spec: "" },
                    ]),
                  )
                }
              >
                {t.paperOutlineAddFigure}
              </button>
              <button
                type="button"
                className="inline-chat-action"
                disabled={busy || i === 0}
                onClick={() => setOutline(moveSection(outline, i, -1))}
              >
                {t.paperOutlineMoveUp}
              </button>
              <button
                type="button"
                className="inline-chat-action"
                disabled={busy || i === last}
                onClick={() => setOutline(moveSection(outline, i, 1))}
              >
                {t.paperOutlineMoveDown}
              </button>
              <button
                type="button"
                className="inline-chat-action"
                disabled={busy}
                onClick={() =>
                  setOutline(addSection(outline, i, t.paperOutlineNewSection))
                }
              >
                {t.paperOutlineAddSection}
              </button>
              <button
                type="button"
                className="inline-chat-action"
                disabled={busy || last === 0}
                onClick={() => setOutline(removeSection(outline, i))}
              >
                {t.paperOutlineRemoveSection}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <footer className="paper-outline-foot">
        <button
          type="button"
          className="inline-chat-action inline-chat-action-primary"
          disabled={busy || outline.sections.some((s) => !s.title.trim())}
          onClick={() => onApprove(outline)}
        >
          {busy ? t.paperOutlineApproving : t.paperOutlineApprove}
        </button>
      </footer>
    </section>
  );
}
