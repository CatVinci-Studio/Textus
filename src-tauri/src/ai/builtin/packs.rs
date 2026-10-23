//! Reference packs - the writing standards a skill can pull in, per
//! language - and the sections of them a model is sent.

use super::*;

/// One reference pack: its name and its `## sections`, in file order.
pub(crate) struct Pack {
    pub name: String,
    pub sections: Vec<(String, String)>,
}

impl Pack {
    pub(crate) fn section(&self, name: &str) -> Option<&str> {
        self.sections
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, text)| text.as_str())
    }
}

/// The reference packs, parsed once.
pub(crate) fn packs() -> &'static [Pack] {
    static PACKS: OnceLock<Vec<Pack>> = OnceLock::new();
    PACKS.get_or_init(|| {
        PACK_FILES
            .iter()
            .map(|(stem, text)| {
                let skill = parse_skill_file(stem, text);
                Pack {
                    name: skill.name,
                    sections: split_sections(&skill.prompt),
                }
            })
            .collect()
    })
}

pub(crate) fn pack(name: &str) -> Option<&'static Pack> {
    packs().iter().find(|p| p.name == name)
}

/// A pack body's `## name` sections, each with its text trimmed.
pub(crate) fn split_sections(body: &str) -> Vec<(String, String)> {
    let mut sections: Vec<(String, String)> = Vec::new();
    for line in body.lines() {
        if let Some(name) = line.strip_prefix("## ") {
            sections.push((name.trim().to_string(), String::new()));
        } else if let Some((_, text)) = sections.last_mut() {
            text.push_str(line);
            text.push('\n');
        }
    }
    for (_, text) in &mut sections {
        *text = text.trim().to_string();
    }
    sections
}

// ------------------------------------------------------------ languages

/// The document languages with a standards pack: (pack code, English name,
/// UI language code of src/i18n/langs.ts).
pub(crate) const PACK_LANGUAGES: &[(&str, &str, &str)] = &[
    ("en", "English", "en"),
    ("zh-hans", "Simplified Chinese", "zh"),
    ("zh-hant", "Traditional Chinese", "zh-Hant"),
    ("ja", "Japanese", "ja"),
    ("ko", "Korean", "ko"),
    ("es", "Spanish", "es"),
    ("fr", "French", "fr"),
    ("de", "German", "de"),
    ("ru", "Russian", "ru"),
    ("pt", "Portuguese", "pt"),
];

pub(crate) fn language_name(code: &str) -> &'static str {
    PACK_LANGUAGES
        .iter()
        .find(|(c, _, _)| *c == code)
        .map_or("an unknown language", |(_, name, _)| name)
}

// ------------------------------------------------- what the model reads

/// A `[tag]` or `[tag, tag]` at the start of a rule line: profile names
/// (`zh-Hant-TW`, `en-GB/govuk`), profile parts (`fiction`, `gongwen`) or
/// settings (`quotes=corner`). Anything with spaces inside is not a tag.
pub(crate) fn leading_tags(line: &str) -> Option<Vec<&str>> {
    let rest = line
        .trim_start()
        .strip_prefix("- ")
        .unwrap_or(line.trim_start());
    let inner = rest.strip_prefix('[')?;
    let end = inner.find(']')?;
    let tags: Vec<&str> = inner[..end].split(',').map(str::trim).collect();
    tags.iter()
        .all(|t| {
            !t.is_empty()
                && t.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-/._=".contains(c))
        })
        .then_some(tags)
}

/// Whether a variant tag applies under a writing-conventions profile such
/// as `zh-Hans-CN/fiction` or `en-GB/govuk`.
pub(crate) fn tag_applies(tag: &str, profile: &str) -> bool {
    if tag.contains('=') {
        // A setting: the line says what it depends on.
        return true;
    }
    let (base, variant) = profile.split_once('/').unwrap_or((profile, ""));
    let tag_l = tag.to_ascii_lowercase();
    let base_l = base.to_ascii_lowercase();
    tag_l == profile.to_ascii_lowercase()
        || tag_l == base_l
        || base_l.starts_with(&format!("{tag_l}-"))
        || (!variant.is_empty() && tag_l == variant.to_ascii_lowercase())
}

/// Bookkeeping at the end of a rule line that only maintainers need: the
/// `(M)`/`(S)` marks (enforced in code or only by the model) and the
/// bracketed source keys.
pub(crate) fn strip_bookkeeping(line: &str) -> String {
    let mut line = line.trim_end().to_string();
    if line.ends_with(']') {
        if let Some(at) = line.rfind(" [") {
            if leading_tags(&line[at + 1..]).is_none() || at > 2 {
                line.truncate(at);
            }
        }
    }
    let trimmed = line.trim_end();
    if trimmed.ends_with(')') {
        if let Some(open) = trimmed.rfind('(') {
            let inner = &trimmed[open + 1..trimmed.len() - 1];
            let mut chars = inner.chars();
            let first = chars.next();
            let second = chars.next();
            let mark = matches!(first, Some('M') | Some('S'))
                && matches!(second, None | Some(' ') | Some('/') | Some(',') | Some(';'))
                || matches!(inner, "guard" | "setting" | "renderer");
            if mark {
                line.truncate(open);
            }
        }
    }
    line.trim_end().to_string()
}

/// A pack section as the model reads it: rule lines tagged for another
/// profile dropped (all kept when no profile is set), source lines and
/// bookkeeping removed.
pub(crate) fn section_for_model(text: &str, profile: Option<&str>) -> String {
    text.lines()
        .filter(|line| !line.trim_start().starts_with("- Sources:"))
        .filter(|line| match (leading_tags(line), profile) {
            (Some(tags), Some(profile)) => tags.iter().any(|t| tag_applies(t, profile)),
            _ => true,
        })
        .map(strip_bookkeeping)
        .collect::<Vec<_>>()
        .join("\n")
}

/// The line that opens the attached conventions: which language (and
/// profile) they are for and how variants are decided.
pub(crate) fn conventions_header(
    language: Option<(&str, LanguageSource)>,
    profile: Option<&str>,
) -> String {
    match (profile, language) {
        (Some(profile), _) => format!(
            "Conventions for this document: {profile} (the writing conventions chosen for this project or in Settings). Rules tagged for other profiles are left out."
        ),
        (None, Some((code, source))) => {
            let how = match source {
                LanguageSource::Detected => "detected from the document",
                LanguageSource::UiLanguage => {
                    "assumed from the app's language; the document has too little text to tell"
                }
            };
            format!(
                "Conventions for this document: {} ({how}). No writing-conventions profile is set: where the rules give variants (tags in square brackets) or name a setting, follow the form the document already uses most and flag only inconsistency.",
                language_name(code)
            )
        }
        (None, None) => "Conventions for this document: the language couldn't be determined; apply only the universal rules and the document's own habits.".to_string(),
    }
}

/// One pack reference resolved to (label, text): `contract`, `craft#plain`,
/// `standards#dialogue` (the document language's pack), `standards-fr` (a
/// whole pack). None when the pack or section doesn't exist - a language's
/// pack leaves out sections it has nothing for.
pub(crate) fn resolve(reference: &str, language: Option<&str>) -> Vec<(String, String)> {
    let (pack_name, section) = match reference.split_once('#') {
        Some((p, s)) => (p, Some(s)),
        None => (reference, None),
    };
    let pack_name = match (pack_name, language) {
        ("standards", Some(code)) => format!("standards-{code}"),
        ("standards", None) => return Vec::new(),
        (name, _) => name.to_string(),
    };
    let Some(pack) = pack(&pack_name) else {
        return Vec::new();
    };
    match section {
        Some(section) => pack
            .section(section)
            .map(|text| vec![(format!("{pack_name}#{section}"), text.to_string())])
            .unwrap_or_default(),
        None if pack.sections.len() == 1 => vec![(pack_name.clone(), pack.sections[0].1.clone())],
        None => pack
            .sections
            .iter()
            .map(|(name, text)| (format!("{pack_name}#{name}"), text.clone()))
            .collect(),
    }
}

/// The attached references as one block: the conventions header (when a
/// language's pack is among them) and each section under its label.
pub(crate) fn render_references(
    refs: &[(String, String)],
    language: Option<(&str, LanguageSource)>,
    profile: Option<&str>,
    target: Option<&str>,
) -> String {
    let mut out = Vec::new();
    // The header describes the document's own conventions: shown with its
    // language's pack, not with another language's (a translation target).
    if let Some((code, _)) = language {
        let own = format!("standards-{code}#");
        if refs.iter().any(|(label, _)| label.starts_with(&own)) {
            out.push(conventions_header(language, profile));
        }
    }
    if let Some(target) = target {
        out.push(format!(
            "Target language: {} - its conventions are attached as standards-{target}.",
            language_name(target)
        ));
    }
    for (label, text) in refs {
        out.push(format!("### {label}\n{}", section_for_model(text, profile)));
    }
    out.join("\n\n")
}

/// What use_skill returns for a pack name instead of a skill's:
/// `standards-ja`, `standards-fr#dialogue`, `craft#platforms`,
/// `standards#numbers` (the document's language). None when there is no
/// such pack or section.
pub(crate) fn load_reference(name: &str, document: &str, ui_language: &str) -> Option<String> {
    let language = document_language(document, ui_language);
    let refs = resolve(name.trim(), language.map(|(code, _)| code));
    if refs.is_empty() {
        return None;
    }
    Some(render_references(&refs, language, None, None))
}

/// The pack names the skill index lists for the model.
pub(crate) fn reference_pack_names() -> Vec<&'static str> {
    PACK_FILES
        .iter()
        .map(|(name, _)| *name)
        .filter(|name| *name != "contract")
        .collect()
}
