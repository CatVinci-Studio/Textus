//! The app's UI languages as the AI prompts need them. The frontend sends
//! the user's UI language with an agent request (src/i18n/langs.ts has the
//! codes); everything per language lives in a file of that language's own -
//! ui-names/<code>.txt and style-headings/<code>.txt - so translating the
//! app touches no code here (docs/dev/translating.md).

/// A UI language (LANGS in src/i18n/langs.ts - a test keeps the two lists
/// the same), with its name in English and in itself, and:
/// - `names`: the names its UI gives the app's concepts and controls,
///   ui-names/<code>.txt, which gives every line of ui-names/en.txt as
///   "<English name> = <the name in this UI>" - or nothing until that UI
///   is translated (agent.rs's tests check each name against the UI's
///   strings and help guide);
/// - `style_headings`: the headings of a style profile written in this
///   language, style-headings/<code>.txt - those of its UI's starter
///   profile (projectStyleTemplate) among them, so "Learn my style" heads
///   a profile the way "Create style profile" does (project.rs's tests
///   check it). Empty until translated.
pub(crate) struct UiLanguage {
    pub code: &'static str,
    pub english: &'static str,
    pub native: &'static str,
    pub names: &'static str,
    pub style_headings: &'static str,
}

macro_rules! ui_language {
    ($code:literal, $english:literal, $native:literal) => {
        UiLanguage {
            code: $code,
            english: $english,
            native: $native,
            names: include_str!(concat!("ui-names/", $code, ".txt")),
            style_headings: include_str!(concat!("style-headings/", $code, ".txt")),
        }
    };
}

pub(crate) const UI_LANGUAGES: &[UiLanguage] = &[
    ui_language!("en", "English", "English"),
    ui_language!("zh", "Chinese", "中文"),
    ui_language!("zh-Hant", "Traditional Chinese", "繁體中文"),
    ui_language!("ja", "Japanese", "日本語"),
    ui_language!("ko", "Korean", "한국어"),
    ui_language!("es", "Spanish", "Español"),
    ui_language!("fr", "French", "Français"),
    ui_language!("de", "German", "Deutsch"),
    ui_language!("ru", "Russian", "Русский"),
    ui_language!("pt", "Portuguese", "Português"),
];

/// A file's entries: its lines, less comments and blank ones.
pub(crate) fn entries(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

/// The names the user's UI gives what the prompt describes in English, as
/// (English, theirs) pairs - None for an English UI (en.txt only lists the
/// English names), or one whose names aren't translated yet. Only that one
/// language goes into the prompt, not a table of every language: it stays
/// short, and for any one user the same from request to request, which the
/// provider's prompt cache needs. Given inline as "style profile (文风档案
/// / 文体プロファイル)", the names came back as glosses - "资料库
/// （library）", "style profile (文风档案)" - in the round-2 integration,
/// hence a table of their own.
pub(crate) struct UiNames {
    pub language: &'static UiLanguage,
    pub names: Vec<(&'static str, &'static str)>,
}

impl UiNames {
    pub fn of(code: &str) -> Option<Self> {
        let language = UI_LANGUAGES.iter().find(|l| l.code == code)?;
        let names: Vec<_> = entries(language.names)
            .filter_map(|line| line.split_once(" = "))
            .collect();
        (!names.is_empty()).then_some(UiNames { language, names })
    }

    /// This UI's name for what the English UI calls `english`.
    pub fn of_english(&self, english: &'static str) -> &'static str {
        self.names
            .iter()
            .find(|(en, _)| *en == english)
            .map_or(english, |(_, name)| name)
    }
}

impl UiLanguage {
    /// "# Style profile / ## Voice and tone / …": style-headings/<code>.txt
    /// as Markdown, the title a `#` heading and the sections `##` ones.
    pub fn style_headings(&self) -> Option<String> {
        let line = entries(self.style_headings).next()?;
        let headings: Vec<String> = line
            .split(" / ")
            .enumerate()
            .map(|(i, heading)| format!("{} {}", if i == 0 { "#" } else { "##" }, heading.trim()))
            .collect();
        Some(headings.join(" / "))
    }
}

/// "English: # Style profile / ## Voice and tone / …", one line for each
/// language whose style-profile headings are translated.
pub(crate) fn style_heading_lines() -> String {
    UI_LANGUAGES
        .iter()
        .filter_map(|language| {
            let headings = language.style_headings()?;
            Some(format!("{}: {headings}", language.english))
        })
        .collect::<Vec<_>>()
        .join("\n")
}
