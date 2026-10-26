//! The app's UI languages as the AI prompts need them. Everything per language
//! lives in its own files (ui-names/<code>.txt, style-headings/<code>.txt), so
//! translating the app touches no code here.

/// A UI language (keep in step with the frontend's LANGS; a test checks), with
/// its names for the app's concepts and its style-profile headings, both empty
/// until translated.
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
/// (English, theirs) pairs; None for English or untranslated. One language
/// only, so the prompt stays short and cacheable; a table, not inline glosses.
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
