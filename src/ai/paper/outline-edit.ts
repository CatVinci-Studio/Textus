import type {
  FigureKind,
  FigurePlan,
  Outline,
  OutlineSection,
} from "../../platform/bindings/ai-paper";

/** The figure kinds, in the order the card offers them. */
export const FIGURE_KINDS: FigureKind[] = [
  "mermaid",
  "chart",
  "web",
  "generated",
];

/** `outline` with section `index` changed by `change`. */
export function editSection(
  outline: Outline,
  index: number,
  change: Partial<OutlineSection>,
): Outline {
  return {
    ...outline,
    sections: outline.sections.map((s, i) =>
      i === index ? { ...s, ...change } : s,
    ),
  };
}

/** `outline` with section `index` moved `by` places (-1 up, 1 down); at
 *  an end it stays. */
export function moveSection(
  outline: Outline,
  index: number,
  by: -1 | 1,
): Outline {
  const to = index + by;
  if (to < 0 || to >= outline.sections.length) return outline;
  const sections = [...outline.sections];
  [sections[index], sections[to]] = [sections[to], sections[index]];
  return { ...outline, sections };
}

/** `outline` without section `index`. The last one stays: an outline
 *  needs a section. */
export function removeSection(outline: Outline, index: number): Outline {
  if (outline.sections.length <= 1) return outline;
  return {
    ...outline,
    sections: outline.sections.filter((_, i) => i !== index),
  };
}

/** `outline` with an empty section after `index`, as long as the one
 *  before it. */
export function addSection(
  outline: Outline,
  index: number,
  title: string,
): Outline {
  const sections = [...outline.sections];
  sections.splice(index + 1, 0, {
    title,
    keyPoints: [],
    evidence: [],
    targetWords: outline.sections[index]?.targetWords ?? 800,
    figures: [],
  });
  return { ...outline, sections };
}

/** Section `index`'s figures changed by `change`. */
export function editFigures(
  outline: Outline,
  index: number,
  change: (figures: FigurePlan[]) => FigurePlan[],
): Outline {
  const section = outline.sections[index];
  return section
    ? editSection(outline, index, { figures: change(section.figures) })
    : outline;
}

/** Key points as the card edits them: one a line. Blank lines are kept
 *  while typing and dropped when the outline is saved. */
export const keyPointsText = (points: string[]) => points.join("\n");
export const keyPointsFrom = (text: string) => text.split("\n");

/** The paper's length as the sections add it up. */
export const totalLength = (outline: Outline) =>
  outline.sections.reduce((sum, s) => sum + s.targetWords, 0);
