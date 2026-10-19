//! The skills and writing-standards reference packs bundled with the app.
//!
//! ```text
//! skills/
//! ├── continue-story.md … theme.md       <- the built-in skills (SKILL_FILES)
//! ├── packs/                             <- the reference packs (PACK_FILES)
//! │   ├── contract.md                    <- the editing contract every built-in follows
//! │   ├── craft.md                       <- fiction, plain language, email, platforms
//! │   └── standards-<lang>.md            <- one per document language
//! └── ATTRIBUTION.md                     <- credits for the adapted texts
//! ```
//!
//! All of it is compiled in with `include_str!`, like ui-names/*.txt, so it
//! needs no resource path or file access (iOS included) and the app never
//! writes it. A skill is an Agent Skills file (frontmatter + body, parsed
//! by workspace::parse_skill_file); the user's global skills/ and the
//! project's .textus/skills/ override a built-in of the same name
//! (workspace::load_layers), Customize… copies one there, and Settings can
//! turn one off.
//!
//! A pack is split into `## sections` with the same names in every
//! language's pack (`typography`, `numbers`, `words`, `dialogue`,
//! `register`, `letters`, `official`, `academic`, `social`, `ai-tells`), so
//! a skill asks for `standards#dialogue` whatever the document's language.
//! The sections a skill lists in `textus-packs` are appended to its body
//! when it is used - by `/name` (expand_message) or use_skill - so there is
//! no second round trip to fetch them; the model can also load any section
//! with `use_skill("standards-fr#dialogue")` (load_reference).

use crate::ai::workspace::{parse_skill_file, AgentSkill, Invocation, SkillSource};
use std::sync::OnceLock;

macro_rules! bundled {
    ($dir:literal; $($name:literal),* $(,)?) => {
        &[$(($name, include_str!(concat!($dir, $name, ".md")))),*]
    };
}

/// The built-in skills, by file stem (which is also each skill's name).
pub(crate) const SKILL_FILES: &[(&str, &str)] = bundled!("skills/";
    "continue-story",
    "describe",
    "dialogue",
    "imitate-style",
    "expand",
    "tighten",
    "change-tone",
    "de-ai",
    "translate",
    "proofread",
    "continuity",
    "email",
    "notice",
    "minutes",
    "academic-polish",
    "social-post",
    "headline",
    "summarize",
    "theme",
);

/// The reference packs, by file stem (= the name use_skill loads them by).
pub(crate) const PACK_FILES: &[(&str, &str)] = bundled!("skills/packs/";
    "contract",
    "craft",
    "standards-en",
    "standards-zh-hans",
    "standards-zh-hant",
    "standards-ja",
    "standards-ko",
    "standards-es",
    "standards-fr",
    "standards-de",
    "standards-ru",
    "standards-pt",
);

/// Credits for the adapted texts in the skills and packs (also shown in
/// Help > Acknowledgements).
pub(crate) const ATTRIBUTION: &str = include_str!("skills/ATTRIBUTION.md");

/// ATTRIBUTION.md as Markdown, for Help > Acknowledgements.
#[tauri::command]
pub fn builtin_skills_attribution() -> &'static str {
    ATTRIBUTION
}

/// The `/` menu's groups, in menu order (`textus-category`).
pub(crate) const CATEGORY_ORDER: &[&str] = &["write", "revise", "check", "format"];

/// The built-in skills, parsed once.
pub(crate) fn skills() -> &'static [AgentSkill] {
    static SKILLS: OnceLock<Vec<AgentSkill>> = OnceLock::new();
    SKILLS.get_or_init(|| {
        SKILL_FILES
            .iter()
            .map(|(stem, text)| AgentSkill {
                source: SkillSource::Builtin,
                ..parse_skill_file(stem, text)
            })
            .collect()
    })
}

/// The built-in skill called `name`.
pub(crate) fn find(name: &str) -> Option<&'static AgentSkill> {
    skills().iter().find(|s| s.name == name)
}

/// A built-in skill's file as bundled (what Customize… copies).
pub(crate) fn raw(name: &str) -> Option<&'static str> {
    SKILL_FILES
        .iter()
        .find(|(stem, _)| *stem == name)
        .map(|(_, text)| *text)
}

/// A built-in skill's file with `textus-based-on` added under `metadata:`,
/// for the copy Customize… writes.
pub(crate) fn with_based_on(raw: &str, based_on: &str) -> String {
    let line = format!("  textus-based-on: \"{based_on}\"");
    let mut out = Vec::new();
    let mut added = false;
    for l in raw.lines() {
        out.push(l.to_string());
        if !added && l.trim_end() == "metadata:" {
            out.push(line.clone());
            added = true;
        }
    }
    let mut text = out.join("\n");
    if raw.ends_with('\n') {
        text.push('\n');
    }
    text
}

/// One reference pack: its name and its `## sections`, in file order.
pub(crate) struct Pack {
    pub name: String,
    pub sections: Vec<(String, String)>,
}

impl Pack {
    fn section(&self, name: &str) -> Option<&str> {
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

fn pack(name: &str) -> Option<&'static Pack> {
    packs().iter().find(|p| p.name == name)
}

/// A pack body's `## name` sections, each with its text trimmed.
fn split_sections(body: &str) -> Vec<(String, String)> {
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

fn language_name(code: &str) -> &'static str {
    PACK_LANGUAGES
        .iter()
        .find(|(c, _, _)| *c == code)
        .map_or("an unknown language", |(_, name, _)| name)
}

/// Where the document's language came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LanguageSource {
    /// Read from the document's own text.
    Detected,
    /// The document has too little text to tell; the app's UI language.
    UiLanguage,
}

/// The pack language for this document: read from its text, else the UI
/// language's, else none.
pub(crate) fn document_language(
    document: &str,
    ui_language: &str,
) -> Option<(&'static str, LanguageSource)> {
    if let Some(code) = detect(document) {
        return Some((code, LanguageSource::Detected));
    }
    PACK_LANGUAGES
        .iter()
        .find(|(_, _, ui)| *ui == ui_language)
        .map(|(code, _, _)| (*code, LanguageSource::UiLanguage))
}

/// Best guess at a document's pack language, from its prose (code, URLs
/// and Markdown markup left out); None when there is too little to tell.
/// The rules engine's detector (rules::detect), as a pack code.
pub(crate) fn detect(text: &str) -> Option<&'static str> {
    use crate::ai::rules::Lang;
    Some(match crate::ai::rules::detect::detect(text)? {
        Lang::ZhHans => "zh-hans",
        Lang::ZhHant => "zh-hant",
        Lang::En => "en",
        Lang::Ja => "ja",
        Lang::Ko => "ko",
        Lang::Es => "es",
        Lang::Fr => "fr",
        Lang::De => "de",
        Lang::Ru => "ru",
        Lang::Pt => "pt",
    })
}

/// Names of the pack languages in the ten UI languages, lowercase, for
/// finding a translation's target in a request. Latin and Cyrillic entries
/// match at a word start, so inflected forms (Englische, английского)
/// count; CJK ones anywhere.
const LANGUAGE_NAMES: &[(&str, &[&str])] = &[
    (
        "en",
        &[
            "english", "英语", "英文", "英語", "영어", "inglés", "ingles", "anglais", "englisch",
            "англ", "inglês",
        ],
    ),
    (
        "zh-hans",
        &[
            "simplified chinese",
            "chinese",
            "mandarin",
            "中文",
            "汉语",
            "汉文",
            "简体",
            "簡體",
            "中国語",
            "중국어",
            "chino",
            "chinois",
            "chinesisch",
            "китайск",
            "chinês",
        ],
    ),
    (
        "zh-hant",
        &[
            "traditional chinese",
            "繁体",
            "繁體",
            "正體",
            "台湾",
            "台灣",
            "臺灣",
            "번체",
            "chino tradicional",
            "chinois traditionnel",
            "traditionelles chinesisch",
            "traditionellem chinesisch",
            "традиционный китайский",
            "chinês tradicional",
        ],
    ),
    (
        "ja",
        &[
            "japanese",
            "日语",
            "日文",
            "日語",
            "日本語",
            "일본어",
            "japonés",
            "japones",
            "japonais",
            "japanisch",
            "японск",
            "japonês",
        ],
    ),
    (
        "ko",
        &[
            "korean",
            "韩语",
            "韩文",
            "韓語",
            "韓文",
            "韓国語",
            "한국어",
            "coreano",
            "coréen",
            "koreanisch",
            "корейск",
        ],
    ),
    (
        "es",
        &[
            "spanish",
            "西班牙语",
            "西班牙文",
            "西班牙語",
            "スペイン語",
            "스페인어",
            "español",
            "castellano",
            "espagnol",
            "spanisch",
            "испанск",
            "espanhol",
        ],
    ),
    (
        "fr",
        &[
            "french",
            "法语",
            "法文",
            "法語",
            "フランス語",
            "프랑스어",
            "francés",
            "frances",
            "français",
            "französisch",
            "французск",
            "francês",
        ],
    ),
    (
        "de",
        &[
            "german",
            "德语",
            "德文",
            "德語",
            "ドイツ語",
            "독일어",
            "alemán",
            "aleman",
            "allemand",
            "deutsch",
            "немецк",
            "alemão",
        ],
    ),
    (
        "ru",
        &[
            "russian",
            "俄语",
            "俄文",
            "俄語",
            "ロシア語",
            "러시아어",
            "ruso",
            "russe",
            "russisch",
            "русск",
            "russo",
        ],
    ),
    (
        "pt",
        &[
            "portuguese",
            "葡萄牙语",
            "葡萄牙文",
            "葡萄牙語",
            "ポルトガル語",
            "포르투갈어",
            "portugués",
            "portugais",
            "portugiesisch",
            "португальск",
            "português",
            "portugues",
        ],
    ),
];

/// Words that come just before a translation's target ("into", "成", "に",
/// "로", "al", "en", "auf", "на"…), to pick the target when a request
/// names two languages ("translate this Chinese text into English").
const TARGET_MARKERS: &[&str] = &[
    "into ", "to ", "成", "为", "為", "到", "に", "로 ", "으로 ", "al ", "a ", "en ", "auf ",
    "ins ", "на ", "para ", "em ", "para o ", "vers ", "in ",
];

/// The pack language a translation request asks for, when it names one -
/// or, naming several, marks one as the target.
pub(crate) fn target_language(request: &str) -> Option<&'static str> {
    let lower = request.to_lowercase();
    // (start, end, code) of every name found.
    let mut found: Vec<(usize, usize, &'static str)> = Vec::new();
    for (code, names) in LANGUAGE_NAMES {
        for name in *names {
            let latin = name
                .chars()
                .next()
                .is_some_and(|c| c.is_alphabetic() && (c as u32) < 0x2e80);
            for (at, _) in lower.match_indices(name) {
                let word_start = !latin
                    || lower[..at]
                        .chars()
                        .next_back()
                        .is_none_or(|c| !c.is_alphanumeric());
                if word_start {
                    found.push((at, at + name.len(), code));
                }
            }
        }
    }
    // A name inside a longer one ("chinese" in "traditional chinese",
    // "中文" in "繁體中文" is not, but "繁體" is first) loses to it.
    let all = found.clone();
    found.retain(|&(s, e, _)| {
        !all.iter()
            .any(|&(s2, e2, _)| s2 <= s && e <= e2 && (e2 - s2) > (e - s))
    });
    // "繁體中文" names 繁體 and 中文 side by side: one name.
    found.sort();
    let mut merged: Vec<(usize, usize, &'static str)> = Vec::new();
    for item in found {
        match merged.last_mut() {
            Some(last) if item.0 <= last.1 && last.2 == "zh-hant" && item.2 == "zh-hans" => {
                last.1 = last.1.max(item.1)
            }
            Some(last) if item.0 <= last.1 && last.2 == "zh-hans" && item.2 == "zh-hant" => {
                *last = (last.0, last.1.max(item.1), "zh-hant")
            }
            _ => merged.push(item),
        }
    }
    let mut codes: Vec<&str> = merged.iter().map(|m| m.2).collect();
    codes.dedup();
    match codes.as_slice() {
        [] => None,
        [one] => Some(one),
        _ => {
            let marked: Vec<&str> = merged
                .iter()
                .filter(|(s, _, _)| TARGET_MARKERS.iter().any(|m| lower[..*s].ends_with(m)))
                .map(|m| m.2)
                .collect();
            match marked.as_slice() {
                [one, ..] if marked.iter().all(|c| c == one) => Some(one),
                _ => None,
            }
        }
    }
}

// ------------------------------------------------- what the model reads

/// A `[tag]` or `[tag, tag]` at the start of a rule line: profile names
/// (`zh-Hant-TW`, `en-GB/govuk`), profile parts (`fiction`, `gongwen`) or
/// settings (`quotes=corner`). Anything with spaces inside is not a tag.
fn leading_tags(line: &str) -> Option<Vec<&str>> {
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
fn tag_applies(tag: &str, profile: &str) -> bool {
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
fn strip_bookkeeping(line: &str) -> String {
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
fn conventions_header(language: Option<(&str, LanguageSource)>, profile: Option<&str>) -> String {
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
fn resolve(reference: &str, language: Option<&str>) -> Vec<(String, String)> {
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
fn render_references(
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

/// A skill's instructions as the model gets them: the body, then the pack
/// sections it declares (`textus-packs`) for the document's language, and
/// for a translation the target language's (`textus-target-packs`, when
/// `request` names the target). A skill without packs is just its body.
/// `profile` is the writing-conventions profile, when one is set (None
/// until that setting exists: every variant is kept and the header says to
/// follow the document).
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

/// A skill the user can call by `token` (what follows `/`): its name, or
/// one of its aliases in any language. Turned-off and hidden ones can't be
/// called.
pub(crate) fn find_invocable<'a>(skills: &'a [AgentSkill], token: &str) -> Option<&'a AgentSkill> {
    let callable = || {
        skills
            .iter()
            .filter(|s| s.enabled && s.invocation != Invocation::Hidden)
    };
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

/// The `<skill name="…">` block a `/name` call becomes in the user's
/// message (src/ai/chat/user-message.ts's skillBlock, which folds it back
/// to `/name` in the transcript).
fn skill_block(name: &str, instructions: &str) -> String {
    format!("<skill name=\"{name}\">\n{instructions}\n</skill>")
}

/// Fills in the skill a message calls, right before it is sent: a
/// `<skill name="…">` block (what the composer sends for `/name`, with or
/// without the body inside - the body is replaced either way) or a message
/// starting with `/name` or `／name`. The block then holds the expanded
/// instructions (expand_skill), with the text after it as the request - the
/// same text use_skill would return, so `/name` needs no extra round trip.
/// The name may be an alias. Anything else - an unknown or turned-off
/// skill, no skill at all - comes back unchanged.
#[cfg(test)]
pub(crate) fn expand_message(
    message: &str,
    skills: &[AgentSkill],
    document: &str,
    ui_language: &str,
) -> String {
    expand_message_with(message, skills, document, ui_language, None)
}

/// The writing-conventions profile a skill's packs are filtered by: the
/// one the user chose (project style.md, then Settings) for the document's
/// language. None under Automatic, where every variant stays and the model
/// follows the document's own majority.
pub(crate) fn chosen_profile(
    conventions: &crate::ai::rules::Conventions,
    document: &str,
) -> Option<String> {
    let lang = crate::ai::rules::detect::detect(document)?;
    let profile = conventions.profile_for(lang);
    profile.explicit.then_some(profile.id)
}

/// expand_message, with the packs filtered by `profile` (chosen_profile).
pub(crate) fn expand_message_with(
    message: &str,
    skills: &[AgentSkill],
    document: &str,
    ui_language: &str,
    profile: Option<&str>,
) -> String {
    const OPEN: &str = "<skill name=\"";
    // The last block: the composer's own comes after the attached files and
    // the selection (ChatBody's send path), so a file or a selection that
    // happens to contain `<skill name="…">` text is never what expands.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::workspace::split_frontmatter;

    const UI_CODES: &[&str] = &[
        "en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "ru", "pt",
    ];
    const USER_ONLY: &[&str] = &["expand", "tighten", "change-tone", "summarize"];
    const STANDARD_SECTIONS: &[&str] = &[
        "typography",
        "numbers",
        "words",
        "dialogue",
        "register",
        "letters",
        "official",
        "academic",
        "social",
        "ai-tells",
    ];

    fn is_kebab(name: &str) -> bool {
        !name.is_empty()
            && name.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            })
    }

    /// Rough token count: a CJK, kana or Hangul character is about one
    /// token, other text about four characters per token.
    fn approx_tokens(text: &str) -> usize {
        let wide = text.chars().filter(|c| (*c as u32) >= 0x2e80).count();
        let narrow = text.chars().count() - wide;
        wide + narrow / 4
    }

    #[test]
    fn every_bundled_file_is_listed() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ai/skills");
        let stems = |dir: std::path::PathBuf| -> Vec<String> {
            let mut v: Vec<String> = std::fs::read_dir(dir)
                .unwrap()
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "md"))
                .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
                .filter(|s| s != "ATTRIBUTION")
                .collect();
            v.sort();
            v
        };
        let mut listed: Vec<String> = SKILL_FILES.iter().map(|(s, _)| s.to_string()).collect();
        listed.sort();
        assert_eq!(stems(dir.clone()), listed);
        let mut listed: Vec<String> = PACK_FILES.iter().map(|(s, _)| s.to_string()).collect();
        listed.sort();
        assert_eq!(stems(dir.join("packs")), listed);
        assert_eq!(SKILL_FILES.len(), 19);
        assert_eq!(PACK_FILES.len(), 12);
    }

    #[test]
    fn every_builtin_skill_parses_and_follows_the_format() {
        for (stem, text) in SKILL_FILES {
            let skill = find(stem).unwrap_or_else(|| panic!("{stem} is listed"));
            let (fm, body) = split_frontmatter(text);
            let fm = fm.unwrap_or_else(|| panic!("{stem} has frontmatter"));
            assert_eq!(skill.name, *stem, "name is the file stem");
            assert!(is_kebab(&skill.name), "{stem}: ASCII kebab-case");
            assert_eq!(skill.source, SkillSource::Builtin);
            assert!(skill.enabled);
            let d = &skill.description;
            assert!(
                !d.is_empty() && d.chars().count() <= 500,
                "{stem}: description ≤ 500 ({} chars)",
                d.chars().count()
            );
            assert!(
                !d.contains('<') && !d.contains('>'),
                "{stem}: no < or > in the description"
            );
            assert!(d.contains("Use when"), "{stem}: says when to use it");
            assert_eq!(
                fm.fields.get("license").map(String::as_str),
                Some("MIT"),
                "{stem}"
            );
            for key in [
                "textus-version",
                "textus-invocation",
                "textus-category",
                "textus-packs",
                "textus-sources",
            ] {
                assert!(fm.metadata.contains_key(key), "{stem}: metadata {key}");
            }
            assert_eq!(skill.version.as_deref(), Some("1"), "{stem}");
            assert!(
                CATEGORY_ORDER.contains(&skill.category.as_deref().unwrap_or("")),
                "{stem}: category"
            );
            let expected = if USER_ONLY.contains(stem) {
                Invocation::UserOnly
            } else {
                Invocation::Both
            };
            assert_eq!(skill.invocation, expected, "{stem}: invocation");
            assert!(
                skill.packs.contains(&"contract".to_string()),
                "{stem}: the contract"
            );
            let lines = body.lines().count();
            assert!(lines <= 120, "{stem}: body has {lines} lines");
            for section in ["## Scope", "## Do", "## Don't", "## Deliver"] {
                assert!(
                    skill
                        .prompt
                        .lines()
                        .any(|l| l == section || l.starts_with(&format!("{section} "))),
                    "{stem}: has {section}"
                );
            }
            for text in [text.to_string(), skill.prompt.clone()] {
                assert!(!text.contains("CRITICAL"), "{stem}: no CRITICAL");
                assert!(
                    !text
                        .split(|c: char| !c.is_alphanumeric())
                        .any(|w| w == "MUST"),
                    "{stem}: no MUST"
                );
                for product in ["Levis", "Textus"] {
                    assert!(!text.contains(product), "{stem}: names no product");
                }
            }
            for code in UI_CODES {
                assert!(
                    skill.aliases.get(*code).is_some_and(|a| !a.is_empty()),
                    "{stem}: aliases in {code}"
                );
            }
        }
    }

    #[test]
    fn aliases_are_unique_per_language_and_never_another_skills_name() {
        for code in UI_CODES {
            let mut seen: Vec<(String, &str)> = Vec::new();
            for skill in skills() {
                for alias in skill.aliases.get(*code).into_iter().flatten() {
                    let key = alias.to_lowercase();
                    if let Some((_, other)) = seen.iter().find(|(a, _)| *a == key) {
                        panic!("{code}: alias {alias} of {} is also {other}'s", skill.name);
                    }
                    if let Some(other) = find(&key).filter(|o| o.name != skill.name) {
                        panic!(
                            "{code}: alias {alias} of {} is the skill {}",
                            skill.name, other.name
                        );
                    }
                    seen.push((key, &skill.name));
                }
            }
        }
        // The UI's own words for inline completion never label a skill;
        // as an alias only the Chinese ones appear, on continue-story,
        // where /续写 can only mean writing on.
        let completion = [
            "補完",
            "이어 쓰기",
            "autocompletado",
            "complétion",
            "vervollständigung",
            "автодополнение",
            "autocompletar",
        ];
        for skill in skills() {
            for alias in skill.aliases.values().flatten() {
                assert!(
                    !completion.contains(&alias.to_lowercase().as_str()),
                    "{alias}"
                );
            }
        }
    }

    #[test]
    fn every_pack_parses_with_named_sections() {
        for (stem, text) in PACK_FILES {
            let parsed = parse_skill_file(stem, text);
            assert_eq!(parsed.name, *stem);
            assert_eq!(parsed.invocation, Invocation::Hidden, "{stem}");
            assert!(
                !parsed.description.is_empty() && parsed.description.chars().count() <= 500,
                "{stem}"
            );
            let (fm, _) = split_frontmatter(text);
            let fm = fm.unwrap();
            assert_eq!(
                fm.fields.get("license").map(String::as_str),
                Some("MIT"),
                "{stem}"
            );
            assert!(fm.metadata.contains_key("textus-sources"), "{stem}");
            let pack = pack(stem).unwrap();
            assert!(!pack.sections.is_empty(), "{stem}");
            for (name, body) in &pack.sections {
                assert!(!body.is_empty(), "{stem}#{name} is empty");
                if stem.starts_with("standards-") {
                    assert!(STANDARD_SECTIONS.contains(&name.as_str()), "{stem}#{name}");
                }
                let model = section_for_model(body, None);
                let tokens = approx_tokens(&model);
                assert!(tokens <= 2_000, "{stem}#{name}: about {tokens} tokens");
                assert!(
                    !model.contains("(M)") && !model.contains("(S)"),
                    "{stem}#{name}: bookkeeping stripped"
                );
                assert!(
                    !text.contains("Levis") && !text.contains("Textus"),
                    "{stem}: names no product"
                );
            }
        }
        assert_eq!(pack("contract").unwrap().sections.len(), 1);
        let craft: Vec<&str> = pack("craft")
            .unwrap()
            .sections
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert_eq!(craft, ["fiction", "plain", "email", "platforms"]);
        // Every language has a standards pack.
        for (code, _, _) in PACK_LANGUAGES {
            assert!(pack(&format!("standards-{code}")).is_some(), "{code}");
        }
    }

    #[test]
    fn every_pack_reference_a_skill_makes_exists() {
        for skill in skills() {
            for reference in skill.packs.iter() {
                let (p, section) = reference
                    .split_once('#')
                    .map_or((reference.as_str(), None), |(p, s)| (p, Some(s)));
                if p == "standards" {
                    let section = section.expect("a standards reference names a section");
                    assert!(
                        PACK_LANGUAGES.iter().any(|(code, _, _)| pack(&format!(
                            "standards-{code}"
                        ))
                        .unwrap()
                        .section(section)
                        .is_some()),
                        "{}: standards#{section} exists in some language",
                        skill.name
                    );
                } else {
                    assert!(
                        !resolve(reference, None).is_empty(),
                        "{}: {reference}",
                        skill.name
                    );
                }
            }
            for section in &skill.target_packs {
                assert!(
                    STANDARD_SECTIONS.contains(&section.as_str()),
                    "{}",
                    skill.name
                );
            }
        }
    }

    #[test]
    fn attribution_covers_every_adapted_source() {
        let mut sources = String::new();
        for (_, text) in SKILL_FILES.iter().chain(PACK_FILES) {
            let (fm, _) = split_frontmatter(text);
            sources.push_str(fm.unwrap().metadata.get("textus-sources").unwrap());
            sources.push('\n');
        }
        let needs: &[(&str, &str)] = &[
            ("GOV.UK", "Open Government Licence v3.0"),
            (
                "Google developer documentation style guide",
                "Google developer documentation style guide",
            ),
            (
                "Microsoft Writing Style Guide",
                "Microsoft Writing Style Guide",
            ),
            ("BIPM", "SI Brochure"),
            ("JTF", "JTF日本語標準スタイルガイド"),
            ("文化庁", "文化庁ホームページ"),
            ("Amtliches Regelwerk", "doi:10.14618/s99n-fk38"),
            (
                "EU Interinstitutional Style Guide",
                "Reproduction authorised provided the source is acknowledged",
            ),
            ("clreq", "Requirements for Chinese Text Layout"),
            ("JLReq", "Requirements for Japanese Text Layout"),
        ];
        for (source, line) in needs {
            if sources.contains(source) {
                assert!(
                    ATTRIBUTION.contains(line),
                    "ATTRIBUTION.md credits {source}"
                );
            }
        }
        assert!(ATTRIBUTION.contains("W3C Software and Document License") && ATTRIBUTION.contains("Title to copyright in this work will at all times remain with copyright holders"));
        // Share-alike and non-commercial sources are only ever summarised
        // or used for ideas: their text would pull its licence into ours.
        for marker in ["CC BY-SA", "CC BY-NC", "GPL"] {
            for (at, _) in sources.match_indices(marker) {
                let after: String = sources[at..].chars().take(60).collect();
                assert!(
                    after.contains("summarised") || after.contains("ideas"),
                    "{marker} source used for more than ideas: {after}"
                );
            }
        }
    }

    #[test]
    fn variant_tags_filter_by_profile() {
        let section = "- [zh-Hant-TW] taiwan rule\n- [fiction] fiction rule\n- [en-GB/govuk] govuk rule\n- general rule (M) [P1]\n- [quotes=corner] setting rule\n- Sources: [x]";
        let all = section_for_model(section, None);
        assert_eq!(
            all,
            "- [zh-Hant-TW] taiwan rule\n- [fiction] fiction rule\n- [en-GB/govuk] govuk rule\n- general rule\n- [quotes=corner] setting rule"
        );
        let fiction = section_for_model(section, Some("zh-Hans-CN/fiction"));
        assert!(
            fiction.contains("fiction rule")
                && !fiction.contains("taiwan")
                && !fiction.contains("govuk")
        );
        assert!(fiction.contains("general rule") && fiction.contains("setting rule"));
        let tw = section_for_model(section, Some("zh-Hant-TW/gongwen"));
        assert!(tw.contains("taiwan rule") && !tw.contains("fiction rule"));
        let govuk = section_for_model(section, Some("en-GB/govuk"));
        assert!(govuk.contains("govuk rule"));
        assert!(!section_for_model(section, Some("en-GB/oxford")).contains("govuk rule"));
        // Bookkeeping goes; brackets that are content stay.
        assert_eq!(strip_bookkeeping("- Keep 3G. (guard) [N20]"), "- Keep 3G.");
        assert_eq!(
            strip_bookkeeping("- A rule (M for . and ,; flag only) [RU-M02; §§199–200]"),
            "- A rule"
        );
        assert_eq!(
            strip_bookkeeping("- Mastodon limits (Mastodon docs)"),
            "- Mastodon limits (Mastodon docs)"
        );
        assert_eq!(
            strip_bookkeeping("- [es-ES] « » first"),
            "- [es-ES] « » first"
        );
    }

    #[test]
    fn document_language_detection() {
        assert_eq!(
            detect("林晚推开书店的门，老周正在柜台后面看书。这是她来这座城市的第五年。"),
            Some("zh-hans")
        );
        assert_eq!(
            detect("本校預定於十一月舉辦閱讀週開幕活動，想向貴館借用一樓演講廳。這是我們的請求。"),
            Some("zh-hant")
        );
        assert_eq!(
            detect("雨はまだ降っていた。美咲は改札の前で、何度も時計を見た。"),
            Some("ja")
        );
        assert_eq!(
            detect("이번 업데이트에서는 자료를 내보낼 수 있습니다."),
            Some("ko")
        );
        assert_eq!(
            detect("Москва — столица России, и это большой город."),
            Some("ru")
        );
        assert_eq!(
            detect("The new reading room is open, and it has 48 seats for the students."),
            Some("en")
        );
        assert_eq!(
            detect(
                "El programa comienza a las nueve y la sesión dura una hora con los participantes."
            ),
            Some("es")
        );
        assert_eq!(detect("Le programme commence à neuf heures et la session dure une heure pour les participants."), Some("fr"));
        assert_eq!(
            detect("Die Sitzung beginnt um neun Uhr und dauert eine Stunde für die Teilnehmer."),
            Some("de")
        );
        assert_eq!(
            detect(
                "A sessão começa às nove horas e não termina antes das dez para os participantes."
            ),
            Some("pt")
        );
        assert_eq!(detect("# 42"), None);
        assert_eq!(
            document_language("", "ja"),
            Some(("ja", LanguageSource::UiLanguage))
        );
        assert_eq!(
            document_language("", "zh"),
            Some(("zh-hans", LanguageSource::UiLanguage))
        );
        assert_eq!(document_language("", "it"), None);
    }

    #[test]
    fn translation_targets_are_found_in_every_ui_language() {
        for (request, want) in [
            ("翻译成中文", Some("zh-hans")),
            ("译成日语", Some("ja")),
            ("转成台湾繁体", Some("zh-hant")),
            ("翻成繁體中文", Some("zh-hant")),
            ("Translate this Chinese text into English", Some("en")),
            ("英語に翻訳して", Some("en")),
            ("한국어로 번역해 줘", Some("ko")),
            ("Tradúcelo al inglés", Some("en")),
            ("Traduis en allemand", Some("de")),
            ("Übersetze ins Französische", Some("fr")),
            ("Переведи на английский", Some("en")),
            ("Traduza para o português", Some("pt")),
            ("translate to Spanish", Some("es")),
            ("polish the translation", None),
        ] {
            assert_eq!(target_language(request), want, "{request}");
        }
    }

    fn doc_zh() -> &'static str {
        "# 第一章\n\n林晚推开书店的门，老周正在柜台后面看书。这是她来这座城市的第五年。"
    }

    #[test]
    fn expansion_appends_the_declared_packs_for_the_documents_language() {
        let skill = find("continue-story").unwrap();
        let text = expand_skill(skill, doc_zh(), "en", "", None);
        assert!(text.starts_with(&skill.prompt));
        assert!(text.contains("---references for this skill---"));
        assert!(text.contains(
            "Conventions for this document: Simplified Chinese (detected from the document)"
        ));
        for label in [
            "### contract",
            "### craft#fiction",
            "### standards-zh-hans#dialogue",
            "### standards-zh-hans#ai-tells",
        ] {
            assert!(text.contains(label), "{label}");
        }
        assert!(
            !text.contains("standards-en#"),
            "only the document's language"
        );
        // An English document gets the English pack.
        let en = expand_skill(
            skill,
            "The rain had not stopped when Elena reached the station and the train was late.",
            "zh",
            "",
            None,
        );
        assert!(en.contains("### standards-en#dialogue") && !en.contains("zh-hans#"));
        // The packs' section text arrives without bookkeeping.
        assert!(!text.contains("(M)") && !text.contains("[P17"));
        // A pack a language lacks is simply left out (Korean has no
        // numbers section; notice still gets the rest).
        let notice = expand_skill(
            find("notice").unwrap(),
            "이번 업데이트에서는 자료를 내보낼 수 있습니다. 몇일 뒤에 다시 안내해 드리겠습니다.",
            "ko",
            "",
            None,
        );
        assert!(
            notice.contains("### standards-ko#official")
                && !notice.contains("standards-ko#numbers")
        );
    }

    #[test]
    fn translate_attaches_the_target_language() {
        let skill = find("translate").unwrap();
        let text = expand_skill(skill, doc_zh(), "zh", "译成日语", None);
        assert!(text.contains("Target language: Japanese"));
        for label in [
            "### standards-ja#typography",
            "### standards-ja#numbers",
            "### standards-ja#register",
        ] {
            assert!(text.contains(label), "{label}");
        }
        // No target named: just the contract; the body says to load one.
        let text = expand_skill(skill, doc_zh(), "zh", "", None);
        assert!(text.contains("### contract") && !text.contains("### standards-"));
    }

    #[test]
    fn messages_expand_by_name_alias_or_block() {
        let skills: Vec<AgentSkill> = skills().to_vec();
        let full = expand_skill(find("proofread").unwrap(), doc_zh(), "zh", "第二段", None);
        let want = format!("<skill name=\"proofread\">\n{full}\n</skill>\n\n第二段");
        assert_eq!(
            expand_message("/proofread 第二段", &skills, doc_zh(), "zh"),
            want
        );
        assert_eq!(
            expand_message("/校对 第二段", &skills, doc_zh(), "zh"),
            want,
            "an alias"
        );
        assert_eq!(
            expand_message("／校对 第二段", &skills, doc_zh(), "zh"),
            want,
            "a full-width slash"
        );
        // What the composer sends today (the body filled in from the skill
        // list) and an empty block both become the full expansion, and
        // expanding again changes nothing.
        let composer = format!("<selected-text>\nx\n</selected-text>\n\n<skill name=\"proofread\">\n{}\n</skill>\n\n第二段", find("proofread").unwrap().prompt);
        let expanded = expand_message(&composer, &skills, doc_zh(), "zh");
        assert_eq!(
            expanded,
            format!("<selected-text>\nx\n</selected-text>\n\n{want}")
        );
        assert_eq!(expand_message(&expanded, &skills, doc_zh(), "zh"), expanded);
        let empty = "<skill name=\"proofread\"></skill>\n\n第二段";
        assert_eq!(expand_message(empty, &skills, doc_zh(), "zh"), want);
        // The composer's typed alias survives, for the transcript.
        let typed = "<skill name=\"proofread\" typed=\"/校对\"></skill>\n\n第二段";
        assert_eq!(
            expand_message(typed, &skills, doc_zh(), "zh"),
            want.replace("name=\"proofread\">", "name=\"proofread\" typed=\"/校对\">")
        );
        // A skill block quoted inside an attached file (which goes out
        // first) is the file's text, not a call: only the composer's expands.
        let quoted = format!(
            "<attached-file name=\"notes.md\">\n<skill name=\"translate\"></skill>\n</attached-file>\n\n{empty}"
        );
        assert_eq!(
            expand_message(&quoted, &skills, doc_zh(), "zh"),
            format!(
                "<attached-file name=\"notes.md\">\n<skill name=\"translate\"></skill>\n</attached-file>\n\n{want}"
            )
        );
        // A chosen profile filters the packs; Automatic keeps every variant.
        let mut conv = crate::ai::rules::Conventions::default();
        assert_eq!(chosen_profile(&conv, doc_zh()), None);
        conv.setting = Some(serde_json::json!("zh-Hans-CN/fiction"));
        assert_eq!(
            chosen_profile(&conv, doc_zh()).as_deref(),
            Some("zh-Hans-CN/fiction")
        );
        // Unknown, turned off, or not a skill call: unchanged.
        assert_eq!(
            expand_message("/nope x", &skills, doc_zh(), "zh"),
            "/nope x"
        );
        assert_eq!(
            expand_message("/home/me/file.md", &skills, doc_zh(), "zh"),
            "/home/me/file.md"
        );
        assert_eq!(expand_message("plain", &skills, doc_zh(), "zh"), "plain");
        let mut off = skills.clone();
        off.iter_mut()
            .for_each(|s| s.enabled = s.name != "proofread");
        assert_eq!(
            expand_message("/proofread", &off, doc_zh(), "zh"),
            "/proofread"
        );
        // A user skill without packs keeps the composer's plain block.
        let user = vec![AgentSkill {
            name: "润色".into(),
            prompt: "Polish it.".into(),
            ..AgentSkill::default()
        }];
        assert_eq!(
            expand_message("/润色 第二段", &user, doc_zh(), "zh"),
            "<skill name=\"润色\">\nPolish it.\n</skill>\n\n第二段"
        );
        assert_eq!(
            expand_message("/润色", &user, doc_zh(), "zh"),
            "<skill name=\"润色\">\nPolish it.\n</skill>"
        );
    }

    #[test]
    fn the_theme_skill_answers_to_its_name_in_every_ui_language() {
        let skills: Vec<AgentSkill> = skills().to_vec();
        let theme = find("theme").expect("theme is built in");
        assert_eq!(theme.category.as_deref(), Some("format"));
        for code in UI_CODES {
            for alias in &theme.aliases[*code] {
                assert_eq!(
                    find_invocable(&skills, alias).map(|s| s.name.as_str()),
                    Some("theme"),
                    "{code}: /{alias}"
                );
            }
        }
        let message = expand_message("/theme a calm dark page", &skills, "", "en");
        assert!(message.starts_with("<skill name=\"theme\">\n"));
        assert!(message.contains("`--editor-bg`") && message.ends_with("a calm dark page"));
    }

    #[test]
    fn packs_load_by_name_and_section() {
        let fr = load_reference("standards-fr#dialogue", doc_zh(), "zh").unwrap();
        assert!(
            fr.starts_with("### standards-fr#dialogue"),
            "another language's pack has no document header"
        );
        let numbers = load_reference("standards#numbers", doc_zh(), "zh").unwrap();
        assert!(
            numbers.contains("Simplified Chinese")
                && numbers.contains("### standards-zh-hans#numbers")
        );
        let whole = load_reference("standards-ja", "", "en").unwrap();
        assert!(
            whole.contains("### standards-ja#typography")
                && whole.contains("### standards-ja#ai-tells")
        );
        assert!(load_reference("contract", "", "en")
            .unwrap()
            .starts_with("### contract\n"));
        assert!(load_reference("craft#nope", "", "en").is_none());
        assert!(load_reference("standards-it", "", "en").is_none());
        assert!(!reference_pack_names().contains(&"contract"));
    }

    #[test]
    fn customized_copies_say_what_they_came_from() {
        let raw = raw("tighten").unwrap();
        let copy = with_based_on(raw, "tighten@1");
        let parsed = parse_skill_file("tighten", &copy);
        assert_eq!(parsed.based_on.as_deref(), Some("tighten@1"));
        assert_eq!(parsed.prompt, find("tighten").unwrap().prompt);
        assert_eq!(parsed.invocation, Invocation::UserOnly);
    }
}
