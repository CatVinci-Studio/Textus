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
mod tests;
