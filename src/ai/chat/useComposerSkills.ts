import { useEffect, useMemo, useState } from "react";
import type { AgentSkill } from "../types";
import { ai, type SkillListItem } from "../../platform/ipc";
import type { PickerLabels } from "./ComposerPicker";
import type { AgentMode } from "../../prefs/settings-values";
import {
  listFromWorkspace,
  pickerSkills,
  recentSkills,
  type PickerSkill,
} from "./skill-picker";
import { SKILL_TRIGGER } from "./skill-syntax";
import { useAgentCommands } from "../agents/useAgentOptions";
import type { AgentCommand } from "../agents/agent-offers";

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
  agentAnswers,
}: {
  docPath: string | null;
  workspaceRoot: string | null;
  input: string;
  /** The input Escape closed the menu for; typing reopens it. */
  dismissedInput: string | null;
  lang: PickerLabels["lang"];
  /** Only this mode's skills are offered; none for null. */
  mode: AgentMode | null;
  /** The chat's external agent, if one is chosen, answers what is sent:
   *  its own commands are offered, and sent as typed. */
  agentAnswers: boolean;
}) {
  const agent = useAgentCommands(agentAnswers);
  const agentCommands = agent?.commands ?? null;
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
    if (agentCommands) return agentCommands.map(commandAsSkill);
    return mode ? pickerSkills([...listed, ...extra], lang, mode) : [];
  }, [skillList, skills, lang, mode, agentCommands]);

  return {
    skills,
    available,
    // An agent's commands are its own: none of Textus's recent ones.
    recent: agent ? [] : recent,
    /** Read again after a skill was used, for the menu's Recent group. */
    refreshRecent: () => setRecent(recentSkills()),
    skillTrigger,
    skillMenuOpen,
    /** An agent's command: sent as typed, for the agent to run. */
    passThrough: !!agentCommands,
    /** The agent whose commands the menu lists, for its heading. */
    agentName: agent?.name ?? null,
  };
}

/** An agent's command in the skill menu's shape, by its `/name`. */
function commandAsSkill(command: AgentCommand): PickerSkill {
  return {
    name: command.name,
    label: null,
    hint: command.hint
      ? `${command.description} ${command.hint}`.trim()
      : command.description,
    source: "global",
    category: null,
    terms: [command.name, command.description],
    allTerms: [command.name],
  };
}
