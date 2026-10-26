import { useEffect, useMemo, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";
import { errorText } from "../../utils/error-text";
import { skillsInReply, type ReplySkill } from "./chat-skill";
import { ModeChoice } from "./ModeChoice";

/**
 * Save this skill, under a reply that wrote one: pick its modes and save it
 * into the global skills folder. A later reply with the same skill offers
 * Update.
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
  const { t, settings } = useSettings();
  const [modes, setModes] = useState(skill.modes);
  const [had, setHad] = useState(false);
  const [state, setState] = useState<
    { kind: "new" } | { kind: "saved" } | { kind: "failed"; why: string }
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
  const save = () =>
    ai.saveWrittenSkill(skill.text, modes).then(
      () => setState({ kind: "saved" }),
      (err: unknown) => setState({ kind: "failed", why: errorText(err) }),
    );
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
      {state.kind !== "saved" && (
        <span className="agent-memory-chip-actions">
          <ModeChoice t={t} modes={modes} onChange={setModes} />
          <button type="button" onClick={() => void save()}>
            {had ? t.chatUpdateSkill : t.chatSaveSkill}
          </button>
        </span>
      )}
    </div>
  );
}
