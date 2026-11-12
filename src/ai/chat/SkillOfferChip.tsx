import { fill } from "../../i18n/fill";
import { ai } from "../../platform/ipc";
import type { SkillOffer } from "../../platform/bindings/ai-memory";
import { useSettings } from "../../prefs/SettingsContext";
import { SkillSaveChip, useSkillSave } from "./SkillSaveChip";

/** The call an offer stands in the conversation as. */
export const OFFER_SKILL = "offer_skill";

/** The offer a turn's output holds, or null. */
export function parseSkillOffer(output: string): SkillOffer | null {
  try {
    const o = JSON.parse(output);
    return typeof o?.name === "string" &&
      typeof o.description === "string" &&
      typeof o.instructions === "string"
      ? {
          name: o.name,
          description: o.description,
          instructions: o.instructions,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Under a reply whose request was a procedure of its own: the offer to keep
 * it as a skill, and once saved, the /name it goes by.
 */
export function SkillOfferChip({
  offer,
  docPath,
}: {
  offer: SkillOffer;
  /** The conversation's document: its project folder is where a
   *  project's skill goes. */
  docPath: string | null;
}) {
  const { settings, t } = useSettings();
  const save = useSkillSave(t, ["write"]);
  const saveTo = (scope: "personal" | "project") =>
    void save.run((modes, confirmed) =>
      ai.saveOfferedSkill(
        offer,
        scope,
        docPath,
        settings.agentWorkspaceRoot || null,
        modes,
        confirmed,
      ),
    );
  return (
    <SkillSaveChip
      t={t}
      role="status"
      title={fill(
        save.state.kind === "saved" ? t.skillOfferSaved : t.skillOffer,
        { name: `/${offer.name}` },
      )}
      description={offer.description}
      save={save}
      actions={
        <>
          <button type="button" onClick={() => saveTo("personal")}>
            {save.confirming ? t.skillSaveAnyway : t.skillOfferSave}
          </button>
          {docPath && (
            <button type="button" onClick={() => saveTo("project")}>
              {t.skillOfferSaveProject}
            </button>
          )}
        </>
      }
    />
  );
}
