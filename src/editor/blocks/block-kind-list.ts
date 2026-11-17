import type { Strings } from "../../i18n/strings";
import { fill } from "../../i18n/fill";

/**
 * The kinds of block the app puts in: one list for the Format menu, the
 * right-click menu, a plugin's `textus.insertBlock` and the block handle's
 * Turn Into. `turns`: a block of text can be turned into it.
 */
interface BlockKind {
  id: string;
  label: (t: Strings) => string;
  turns?: boolean;
}

const heading = (level: number): BlockKind => ({
  id: `h${level}`,
  label: (t) => fill(t.menuHeadingTemplate, { n: String(level) }),
  turns: level <= 3,
});

export const BLOCK_KINDS: readonly BlockKind[] = [
  { id: "paragraph", label: (t) => t.blockText, turns: true },
  ...[1, 2, 3, 4, 5, 6].map(heading),
  { id: "bullet-list", label: (t) => t.menuBulletList, turns: true },
  { id: "ordered-list", label: (t) => t.menuOrderedList, turns: true },
  { id: "task-list", label: (t) => t.menuTaskList, turns: true },
  { id: "blockquote", label: (t) => t.menuBlockquote, turns: true },
  { id: "callout", label: (t) => t.blockCallout, turns: true },
  { id: "code-block", label: (t) => t.menuCodeBlock, turns: true },
  { id: "math-block", label: (t) => t.menuMathBlock },
  { id: "table", label: (t) => t.menuTable },
  { id: "rule", label: (t) => t.menuDivider },
];

export const isBlockKind = (id: unknown): id is string =>
  BLOCK_KINDS.some((kind) => kind.id === id);

/** What the menus offer to put in: the first three heading levels. */
export const menuKinds = (turning = false) =>
  BLOCK_KINDS.filter(
    (kind) => !/^h[4-6]$/.test(kind.id) && (!turning || kind.turns),
  );
