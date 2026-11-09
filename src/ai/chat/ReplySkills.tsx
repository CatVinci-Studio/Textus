import { useEffect, useMemo, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import { skillsInReply, type ReplySkill } from "./chat-skill";
import type { AgentMode } from "../../prefs/settings-values";
import { ModeChoice } from "./ModeChoice";
import { explainError } from "../../utils/error-explain";
import { ReplyFilesPreview } from "./ReplyFilesPreview";
import { confirmedFor, SkillWarnings, warningsIn } from "./skill-warnings";
import { useLatest } from "../../utils/hooks/useLatest";
import { withCreation } from "./creations";

/**
 * Save this skill, under a reply that wrote one: pick its modes and save it
 * into the global skills folder. A later reply with the same skill offers
 * Update. Its instructions join later prompts, so one in Create mode or that
 * reads like a prompt injection says why, and saves on a second click.
 */
export function ReplySkills({ text }: { text: string }) {
  const skills = useMemo(() => skillsInReply(text), [text]);
  return (
    <>
      {skills.map((skill, i) => (
        <ReplySkillChip key={i} skill={skill} />
      ))}
    </>
  );
}

function ReplySkillChip({ skill }: { skill: ReplySkill }) {
  const { t, settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [modes, setModes] = useState(skill.modes);
  const [had, setHad] = useState(false);
  const [state, setState] = useState<
    | { kind: "new" }
    | { kind: "saved" }
    | { kind: "failed"; why: string }
    | { kind: "confirm"; warnings: string[]; modes: AgentMode[] }
  >({ kind: "new" });
  // A skill of that name already: this one updates it.
  useEffect(() => {
    let live = true;
    void ai
      .listSkills(null, null)
      .then((list) => {
        if (live && Array.isArray(list))
          setHad(list.some((s) => s.name === skill.name));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [skill.name]);
  const confirming = confirmedFor(
    state.kind === "confirm" ? state : null,
    modes,
  );
  const save = () =>
    ai.saveWrittenSkill(skill.text, modes, confirming !== null).then(
      () => {
        setState({ kind: "saved" });
        setSettings({
          creations: withCreation(latest.current.creations, {
            kind: "skill",
            id: skill.name,
            name: label,
            at: Date.now(),
          }),
        });
      },
      (err: unknown) => {
        const warnings = warningsIn(err);
        setState(
          warnings
            ? { kind: "confirm", warnings, modes }
            : { kind: "failed", why: explainError(err, t) },
        );
      },
    );
  // Said before any click: Create is never ticked for it, and once it is,
  // what that lets the skill do.
  const createNote = confirming?.warnings.includes("create-mode")
    ? null
    : modes.includes("create")
      ? t.skillWarnCreateMode
      : skill.asksForCreate
        ? t.skillWarnCreateAsked
        : null;
  const label =
    skill.labels[settings.language] ?? skill.labels.en ?? `/${skill.name}`;
  return (
    <div className="agent-memory-chip skill-offer-chip" data-skill={skill.name}>
      <span className="agent-memory-chip-text">
        {state.kind === "saved"
          ? t.skillOfferSaved.replace("{name}", `/${skill.name}`)
          : label}
      </span>
      {skill.description && (
        <span className="skill-offer-description">{skill.description}</span>
      )}
      {state.kind === "failed" && (
        <span className="skill-offer-description">{state.why}</span>
      )}
      {createNote && (
        <span className="skill-offer-description skill-offer-warning">
          {createNote}
        </span>
      )}
      <SkillWarnings t={t} confirming={confirming} />
      {state.kind !== "saved" && (
        <span className="agent-memory-chip-actions">
          <ModeChoice t={t} modes={modes} onChange={setModes} />
          <button type="button" onClick={() => void save()}>
            {confirming
              ? t.skillSaveAnyway
              : had
                ? t.chatUpdateSkill
                : t.chatSaveSkill}
          </button>
        </span>
      )}
      <ReplyFilesPreview
        label={t.chatShowSkill}
        files={[{ path: null, text: skill.text }]}
      />
    </div>
  );
}
