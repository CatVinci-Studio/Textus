import { prepareList, rankList } from "../../utils/list-filter";
import { basename } from "../../utils/path";
import type { PickerLabels, PickerRow, PickerSection } from "./ComposerPicker";
import { groupSkills, matchSkills, type PickerSkill } from "./skill-picker";

/** One of a mode's own kinds `/` picks (Research's pieces, Create's makings). */
interface PickerKind {
  key: string;
  label: string;
  pick: () => void;
}

/**
 * What the composer's picker shows: a mode's kinds or the skills for a
 * `/token`, the project's files for an `@query`; and, with nothing to show,
 * why - an empty menu looks like a dead key.
 */
export function pickerContent(o: {
  /** The `/token` typed, while its picker is open. */
  skillTrigger: RegExpExecArray | null;
  /** The `@query` typed, while its picker is open. */
  mentionQuery: RegExpExecArray | null;
  kinds: readonly PickerKind[];
  available: PickerSkill[];
  recent: string[];
  matchingFiles: readonly string[];
  /** The project's files, or null before they are read. */
  projectFiles: readonly string[] | null;
  hasProject: boolean;
  labels: PickerLabels;
  pickKind: (kind: PickerKind) => void;
  pickSkill: (skill: PickerSkill) => void;
  pickFile: (path: string) => void;
}): { sections: PickerSection[]; empty: string[] } {
  const { labels } = o;
  if (o.skillTrigger && o.kinds.length > 0) {
    const query = o.skillTrigger[1].toLowerCase();
    const rows = rankList(
      prepareList(o.kinds.map((k) => ({ ...k, keywords: k.key }))),
      query,
      Infinity,
    ).map((k) => ({
      key: k.key,
      primary: k.label,
      secondary: `/${k.key}`,
      pick: () => o.pickKind(k),
    }));
    return {
      sections: [{ rows }],
      empty: [labels.skillNoMatch.replace("{query}", query)],
    };
  }
  if (o.skillTrigger) {
    const query = o.skillTrigger[1];
    const row = (skill: PickerSkill): PickerRow => ({
      key: skill.name,
      primary: skill.label ?? `/${skill.name}`,
      secondary: skill.label ? `/${skill.name}` : undefined,
      detail: skill.hint || undefined,
      pick: () => o.pickSkill(skill),
    });
    return {
      sections: query
        ? [{ rows: matchSkills(o.available, query, o.recent).map(row) }]
        : groupSkills(o.available, o.recent).map((group) => ({
            title: labels.groups[group.id],
            rows: group.skills.map(row),
          })),
      empty:
        o.available.length === 0
          ? [labels.skillAbout, labels.skillHowTo]
          : [labels.skillNoMatch.replace("{query}", query), labels.skillHowTo],
    };
  }
  if (o.mentionQuery) {
    const rows = o.matchingFiles.map((path) => ({
      key: path,
      primary: `@${basename(path)}`,
      // The folder, when there is one - for a file at the project root the
      // name already says it all.
      detail:
        path !== basename(path)
          ? path.slice(0, path.length - basename(path).length)
          : undefined,
      pick: () => o.pickFile(path),
    }));
    return {
      sections: [{ rows }],
      empty:
        o.projectFiles === null
          ? [labels.mentionAbout]
          : o.projectFiles.length > 0
            ? [labels.mentionNoMatch.replace("{query}", o.mentionQuery[1])]
            : [
                labels.mentionAbout,
                o.hasProject ? labels.mentionNoFiles : labels.mentionNoProject,
              ],
    };
  }
  return { sections: [], empty: [] };
}
