import { useEffect, useMemo, useState } from "react";
import type { AgentSkill } from "../types";
import { ai, type SkillListItem } from "../../platform/ipc";
import type { PickerLabels } from "./ComposerPicker";
import type { AgentMode } from "../../prefs/settings-types";
import {
  SKILL_TRIGGER,
  listFromWorkspace,
  pickerSkills,
  recentSkills,
  type PickerSkill,
} from "./skill-picker";

/**
 * The skills the composer offers, and whether `input` has the `/` menu open.
 */
export function useComposerSkills({
  docPath,
  workspaceRoot,
  input,
  dismissedInput,
  lang,
  mode,
}: {
  docPath: string | null;
  workspaceRoot: string | null;
  input: string;
  /** The input Escape closed the menu for; typing reopens it. */
  dismissedInput: string | null;
  lang: PickerLabels["lang"];
  /** Only this mode's skills are offered. */
  mode: AgentMode;
}) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [skillList, setSkillList] = useState<SkillListItem[] | null>(null);
  const [recent, setRecent] = useState<string[]>(recentSkills);

  // Loaded fresh each time the chat opens, so an edited skill file takes
  // effect on the next chat without a restart.
  useEffect(() => {
    let cancelled = false;
    ai.loadAgentWorkspace(docPath, workspaceRoot)
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docPath, workspaceRoot]);

  // Fetched again each time the menu opens, so a skill installed or moved a
  // moment ago is already there.
  const skillTrigger = SKILL_TRIGGER.exec(input);
  const skillMenuOpen = !!skillTrigger && dismissedInput !== input;
  useEffect(() => {
    if (!skillMenuOpen) return;
    let cancelled = false;
    ai.listSkills(docPath, workspaceRoot)
      .then((list) => {
        if (!cancelled) setSkillList(Array.isArray(list) ? list : null);
      })
      .catch(() => {
        if (!cancelled) setSkillList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [skillMenuOpen, docPath, workspaceRoot]);

  // Plus any workspace skill the list lacks (an older backend lists none).
  const available: PickerSkill[] = useMemo(() => {
    const listed = skillList ?? [];
    const names = new Set(listed.map((s) => s.name));
    const extra = listFromWorkspace(skills.filter((s) => !names.has(s.name)));
    return pickerSkills([...listed, ...extra], lang, mode);
  }, [skillList, skills, lang, mode]);

  return {
    skills,
    available,
    recent,
    /** Read again after a skill was used, for the menu's Recent group. */
    refreshRecent: () => setRecent(recentSkills()),
    skillTrigger,
    skillMenuOpen,
  };
}
