import { fill } from "../../i18n/fill";
import { useEffect, useMemo, useState } from "react";
import { ai } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import { skillsInReply, type ReplySkill } from "./chat-skill";
import { ReplyFilesPreview } from "./ReplyFilesPreview";
import { SkillSaveChip, useSkillSave } from "./SkillSaveChip";
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
  const save = useSkillSave(t, skill.modes);
  const [had, setHad] = useState(false);
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
  const label =
    skill.labels[settings.language] ?? skill.labels.en ?? `/${skill.name}`;
  const { confirming, modes } = save;
  const saveIt = () =>
    save.run(async (modes, confirmed) => {
      await ai.saveWrittenSkill(skill.text, modes, confirmed);
      setSettings({
        creations: withCreation(latest.current.creations, {
          kind: "skill",
          id: skill.name,
          name: label,
          at: Date.now(),
        }),
      });
    });
  // Said before any click: Create is never ticked for it, and once it is,
  // what that lets the skill do.
  const createNote = confirming?.warnings.includes("create-mode")
    ? null
    : modes.includes("create")
      ? t.skillWarnCreateMode
      : skill.asksForCreate
        ? t.skillWarnCreateAsked
        : null;
  return (
    <SkillSaveChip
      t={t}
      data-skill={skill.name}
      title={
        save.state.kind === "saved"
          ? fill(t.skillOfferSaved, { name: `/${skill.name}` })
          : label
      }
      description={skill.description}
      note={createNote}
      save={save}
      actions={
        <button type="button" onClick={() => void saveIt()}>
          {confirming
            ? t.skillSaveAnyway
            : had
              ? t.chatUpdateSkill
              : t.chatSaveSkill}
        </button>
      }
    >
      <ReplyFilesPreview
        label={t.chatShowSkill}
        files={[{ path: null, text: skill.text }]}
      />
    </SkillSaveChip>
  );
}
