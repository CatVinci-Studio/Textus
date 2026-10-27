//! A `/name` in the user's message expanded: the skill found, its
//! references rendered for the document and the profile in use.

use super::*;

/// A skill's instructions as the model gets them: the body, then the pack
/// sections it declares for the document's language (and a translation's
/// target). `profile` filters the variants; None keeps them all.
pub(crate) fn expand_skill(
    skill: &AgentSkill,
    document: &str,
    ui_language: &str,
    request: &str,
    profile: Option<&str>,
) -> String {
    if skill.packs.is_empty() && skill.target_packs.is_empty() {
        return skill.prompt.clone();
    }
    let language = document_language(document, ui_language);
    let mut refs: Vec<(String, String)> = Vec::new();
    for reference in &skill.packs {
        for r in resolve(reference, language.map(|(code, _)| code)) {
            if !refs.iter().any(|(label, _)| *label == r.0) {
                refs.push(r);
            }
        }
    }
    let target = if skill.target_packs.is_empty() {
        None
    } else {
        target_language(request)
    };
    if let Some(target) = target {
        for section in &skill.target_packs {
            for r in resolve(&format!("standards-{target}#{section}"), None) {
                if !refs.iter().any(|(label, _)| *label == r.0) {
                    refs.push(r);
                }
            }
        }
    }
    if refs.is_empty() {
        return skill.prompt.clone();
    }
    format!(
        "{}\n\n---references for this skill---\n{}",
        skill.prompt,
        render_references(&refs, language, profile, target)
    )
}

/// A skill the user can call by `token` (what follows `/`): its name, or
/// one of its aliases in any language. Hidden ones can't be called.
pub(crate) fn find_invocable<'a>(skills: &'a [AgentSkill], token: &str) -> Option<&'a AgentSkill> {
    let callable = || skills.iter().filter(|s| s.invocation != Invocation::Hidden);
    callable().find(|s| s.name == token).or_else(|| {
        let token = token.to_lowercase();
        callable().find(|s| {
            s.aliases
                .values()
                .flatten()
                .any(|a| a.to_lowercase() == token)
        })
    })
}

/// The `<skill name="…">` block a `/name` call becomes in the user's message.
pub(crate) fn skill_block(name: &str, instructions: &str) -> String {
    format!("<skill name=\"{name}\">\n{instructions}\n</skill>")
}

/// Fills in the skill a message calls: a `<skill name="…">` block or a
/// message starting with `/name` gets the expanded instructions, so `/name`
/// needs no extra round trip. Anything else comes back unchanged.
#[cfg(test)]
pub(crate) fn expand_message(
    message: &str,
    skills: &[AgentSkill],
    document: &str,
    ui_language: &str,
) -> String {
    expand_message_with(message, skills, document, ui_language, None)
}

/// The writing-conventions profile the user chose for the document's
/// language. None under Automatic, where every variant stays.
pub(crate) fn chosen_profile(
    conventions: &crate::ai::rules::Conventions,
    document: &str,
) -> Option<String> {
    let lang = crate::ai::rules::detect::detect(document)?;
    let profile = conventions.profile_for(lang);
    profile.explicit.then_some(profile.id)
}

/// expand_message, with the packs filtered by `profile`.
pub(crate) fn expand_message_with(
    message: &str,
    skills: &[AgentSkill],
    document: &str,
    ui_language: &str,
    profile: Option<&str>,
) -> String {
    const OPEN: &str = "<skill name=\"";
    // The last block: the composer's own comes after attached files and the
    // selection, so text inside those never expands.
    if let Some(start) = message.rfind(OPEN) {
        let name_start = start + OPEN.len();
        let Some(name_len) = message[name_start..].find('"') else {
            return message.to_string();
        };
        let name = &message[name_start..name_start + name_len];
        let Some(open_end) = message[name_start..].find('>').map(|i| name_start + i + 1) else {
            return message.to_string();
        };
        let Some(close) = message[open_end..].find("</skill>").map(|i| open_end + i) else {
            return message.to_string();
        };
        let Some(skill) = find_invocable(skills, name) else {
            return message.to_string();
        };
        let rest = &message[close + "</skill>".len()..];
        let expanded = expand_skill(skill, document, ui_language, rest.trim(), profile);
        // Other attributes (`typed="/续写"`: what the user typed, which the
        // transcript shows) stay as they were.
        let attrs = &message[name_start + name_len + 1..open_end - 1];
        return format!(
            "{}<skill name=\"{}\"{attrs}>\n{expanded}\n</skill>{rest}",
            &message[..start],
            skill.name,
        );
    }
    let Some(rest) = message
        .strip_prefix('/')
        .or_else(|| message.strip_prefix('／'))
    else {
        return message.to_string();
    };
    let (token, tail) = rest
        .split_once(char::is_whitespace)
        .map_or((rest, ""), |(t, tail)| (t, tail.trim_start()));
    let Some(skill) = find_invocable(skills, token) else {
        return message.to_string();
    };
    let block = skill_block(
        &skill.name,
        &expand_skill(skill, document, ui_language, tail, profile),
    );
    if tail.is_empty() {
        block
    } else {
        format!("{block}\n\n{tail}")
    }
}
