//! A task worth doing again, offered as a skill: after an exchange whose
//! request was a procedure of its own - several particular requirements
//! for a kind of task the user is likely to ask for again (a house style
//! for translations, a checklist for weekly reports) - one small request
//! decides whether to offer it, and the chat shows the offer under the
//! reply. Saved (save_offered_skill), it is a skill like any other, in the
//! `/` menu from then on. Nothing is saved unasked.

use super::*;
use crate::ai::workspace::{skill_file_path, AgentSkill};

/// A request shorter than this is never a procedure.
const OFFER_FROM_CHARS: usize = 60;

const OFFER_INSTRUCTIONS: &str = r#"You help Textus AI, a writing assistant, learn the user's tasks. You are shown the user's last request, the assistant's reply, and the skills (saved procedures) the user has. Decide whether the request is a procedure worth saving as a new skill: several particular requirements for a kind of task the user is likely to ask for again in other documents (how to translate their newsletters, the checklist for a weekly report, the way to turn notes into minutes). Not a request about this text only ("make this shorter", "fix the typo", "translate this paragraph"), not one a skill they have already does, not a single requirement (that is a memory, not a skill). Most requests are not worth it: when in doubt, offer nothing.

Answer with exactly this JSON and nothing else:
{"skill": null}
or
{"skill": {"name": "<two to four words naming the task, in the user's language>", "description": "<one sentence: what it does and when to use it>", "instructions": "<the procedure, as instructions to the assistant: every requirement the user gave, in order, in the user's language, nothing about this document in particular>"}}"#;

/// A skill offered after an exchange.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct SkillOffer {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

/// Whether the exchange's request is long enough to be a procedure.
pub(crate) fn may_offer(exchange: &Exchange) -> bool {
    exchange
        .messages
        .last()
        .is_some_and(|m| m.trim().chars().count() >= OFFER_FROM_CHARS)
}

fn offer_input(exchange: &Exchange, skills: &[AgentSkill]) -> String {
    let have: Vec<String> = skills
        .iter()
        .map(|s| format!("- {}: {}", s.name, s.description))
        .collect();
    format!(
        "---the user's skills---\n{}\n\n---the user's request---\n{}\n\n---the assistant's reply---\n{}",
        if have.is_empty() { "(none)".to_string() } else { have.join("\n") },
        exchange.messages.last().map(String::as_str).unwrap_or(""),
        exchange.reply.chars().take(1_500).collect::<String>()
    )
}

/// The offer in the answer, or none: an offer needs all three parts, and
/// a name no skill of the user's has.
pub(crate) fn parse_offer(answer: &str, skills: &[AgentSkill]) -> Option<SkillOffer> {
    let (start, end) = (answer.find('{')?, answer.rfind('}')?);
    let value: serde_json::Value = serde_json::from_str(answer.get(start..=end)?).ok()?;
    let offer: SkillOffer = serde_json::from_value(value.get("skill")?.clone()).ok()?;
    // As the `/` menu names a skill (parse_skill_file): words joined by -.
    let offer = SkillOffer {
        name: offer.name.split_whitespace().collect::<Vec<_>>().join("-"),
        description: offer.description.trim().to_string(),
        instructions: offer.instructions.trim().to_string(),
    };
    let taken = skills
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(&offer.name));
    (!offer.name.is_empty()
        && offer.name.chars().count() <= 60
        && !offer.description.is_empty()
        && !offer.instructions.is_empty()
        && !taken)
        .then_some(offer)
}

/// The offer for `exchange`, asked through `call`; none when the request
/// is too short to be a procedure, or the model offers nothing.
pub async fn offer_skill<F, Fut>(
    exchange: &Exchange,
    skills: &[AgentSkill],
    call: F,
) -> Result<Option<SkillOffer>, String>
where
    F: Fn(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    if !may_offer(exchange) {
        return Ok(None);
    }
    let answer = call(
        OFFER_INSTRUCTIONS.to_string(),
        offer_input(exchange, skills),
    )
    .await?;
    Ok(parse_offer(&answer, skills))
}

/// The skill file for `offer`: its name and description as front matter,
/// then its instructions.
pub(crate) fn skill_file(offer: &SkillOffer) -> String {
    let quote = |s: &str| serde_json::to_string(s).unwrap_or_default();
    format!(
        "---\nname: {}\ndescription: {}\nmetadata:\n  textus-invocation: \"both\"\n---\n\n{}\n",
        quote(&offer.name),
        quote(&offer.description),
        offer.instructions
    )
}

/// Writes `offer` into `skills_dir`, never over a skill already there (a
/// number is added to the file's name instead). Its path.
pub(crate) fn save_offer_in(
    skills_dir: &Path,
    offer: &SkillOffer,
    modes: &[crate::ai::agent::AgentMode],
) -> Result<PathBuf, String> {
    if modes.is_empty() {
        return Err("A skill needs at least one mode.".to_string());
    }
    std::fs::create_dir_all(skills_dir).map_err(|e| e.to_string())?;
    let mut named = offer.clone();
    let mut path = skill_file_path(skills_dir, &named.name)?;
    let mut n = 2;
    while path.exists() {
        named.name = format!("{}-{n}", offer.name);
        path = skill_file_path(skills_dir, &named.name)?;
        n += 1;
    }
    let words: Vec<String> = modes.iter().map(|m| m.to_string()).collect();
    let text = crate::ai::workspace::with_metadata(&skill_file(&named), "modes", &words.join(" "));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exchange(message: &str) -> Exchange {
        Exchange {
            messages: vec![message.into()],
            reply: "Done.".into(),
        }
    }

    #[test]
    fn only_a_request_long_enough_may_be_a_procedure() {
        assert!(!may_offer(&exchange("Shorter, please.")));
        assert!(may_offer(&exchange(
            "Translate the newsletter into English: keep the names in pinyin, use British spelling, and put a glossary of the terms at the end."
        )));
    }

    #[test]
    fn an_offer_needs_every_part_and_a_name_of_its_own() {
        let skills = vec![crate::ai::workspace::parse_skill_file(
            "translate",
            "---\nname: translate\ndescription: Translates.\n---\n\nTranslate it.",
        )];
        let ok = r#"{"skill": {"name": "Newsletter translation", "description": "Translates the newsletter.", "instructions": "Keep names in pinyin."}}"#;
        assert_eq!(
            parse_offer(ok, &skills).unwrap().name,
            "Newsletter-translation"
        );
        assert_eq!(parse_offer(r#"{"skill": null}"#, &skills), None);
        assert_eq!(
            parse_offer(
                r#"{"skill": {"name": "Translate", "description": "x", "instructions": "y"}}"#,
                &skills
            ),
            None
        );
        assert_eq!(
            parse_offer(
                r#"{"skill": {"name": "A", "description": "", "instructions": "y"}}"#,
                &skills
            ),
            None
        );
        assert_eq!(parse_offer("no json", &skills), None);
    }

    #[test]
    fn a_saved_offer_is_a_skill_file_and_never_overwrites_one() {
        let dir = tempfile::tempdir().unwrap();
        let offer = SkillOffer {
            name: "Weekly-report".into(),
            description: "Turns notes into the weekly report: \"done\", next, risks.".into(),
            instructions: "Three sections: Done, Next, Risks.".into(),
        };
        let review = [crate::ai::agent::AgentMode::Review];
        let first = save_offer_in(dir.path(), &offer, &review).unwrap();
        let second = save_offer_in(dir.path(), &offer, &review).unwrap();
        let saved =
            crate::ai::workspace::parse_skill_file("x", &std::fs::read_to_string(&first).unwrap());
        assert_eq!(saved.modes, review);
        assert_ne!(first, second);
        let skills = crate::ai::workspace::read_skill_files(dir.path());
        let mut names: Vec<&str> = skills.iter().map(|(_, s)| s.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["Weekly-report", "Weekly-report-2"]);
        let (_, skill) = &skills[0];
        assert!(
            skill.description.contains("\"done\""),
            "{}",
            skill.description
        );
        assert!(skill.prompt.contains("Three sections"), "{}", skill.prompt);
    }
}
