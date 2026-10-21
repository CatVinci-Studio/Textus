import { useEffect, useMemo, useState } from "react";
import type { AgentSkill } from "../types";
import { ai, type SkillListItem } from "../../platform/ipc";
import type { PickerLabels } from "./ComposerPicker";
import {
  SKILL_TRIGGER,
  listFromWorkspace,
  pickerSkills,
  recentSkills,
  type PickerSkill,
} from "./skill-picker";

/**
 * The skills the composer offers (ChatComposer.tsx): the workspace's, read
 * when the chat opens, and the `/` menu's full list, read each time the
 * menu opens - and whether `input` has the menu open.
 */
export function useComposerSkills({
  docPath,
  workspaceRoot,
  input,
  dismissedInput,
  lang,
}: {
  docPath: string | null;
  workspaceRoot: string | null;
  input: string;
  /** The input Escape closed the menu for; typing reopens it. */
  dismissedInput: string | null;
  lang: PickerLabels["lang"];
}) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [skillList, setSkillList] = useState<SkillListItem[] | null>(null);
  const [recent, setRecent] = useState<string[]>(recentSkills);

  // Skills come from the agent workspace on disk (global dir + the workspace
  // root's .textus/skills). Loaded fresh each time the chat opens, so editing
  // a skill file takes effect on the next chat without a restart.
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

  // The `/` menu's list - built-ins included, with their groups and which
  // are on - fetched again each time the menu opens, so a skill turned off
  // in Settings a moment ago is already gone from it.
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

  // The list, plus any workspace skill it lacks (an older backend lists
  // none): what the menu offers and what a typed /word resolves against.
  const available: PickerSkill[] = useMemo(() => {
    const listed = skillList ?? [];
    const names = new Set(listed.map((s) => s.name));
    const extra = listFromWorkspace(skills.filter((s) => !names.has(s.name)));
    return pickerSkills([...listed, ...extra], lang);
  }, [skillList, skills, lang]);

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
