//! Writing conventions profiles: which national norm or house style a
//! document follows, per document language.
//!
//! A profile is a value like `zh-Hans-CN/fiction`, `en-GB/govuk` or
//! `fr-CA`: language (and script), then region, then an optional preset.
//! It comes from, in order:
//!
//! 1. the project's `.textus/style.md` front matter (`conventions:`, one
//!    value or several separated by commas, plus option keys such as
//!    `cjk-latin-space: on`) - [`ProjectConventions::from_style`];
//! 2. the global setting `writingConventions` in settings.json - either
//!    `"automatic"` (the default), one profile as a string (what the
//!    Settings row stores: `"en-GB/govuk"`, for that language only), or an
//!    object from language key to profile,
//!    `{ "zh-Hans": "zh-Hans-CN/tech", "en": "en-GB/govuk" }`, optionally with
//!    an `"options"` object of the same option keys;
//! 3. Automatic: the national norm for the language where one exists (GB/T
//!    for Simplified Chinese, the MOE handbook for Traditional, JTF for
//!    Japanese, the national rules for Korean and Russian, Brazilian
//!    Portuguese as the UI is), none for English, Spanish, French and
//!    German. Wherever sources conflict, Automatic follows the document's
//!    own majority and flags only inconsistency (the rules read
//!    [`Profile::explicit`] for that).

use super::detect::Lang;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// The settings.json key of the global default.
pub const SETTING_KEY: &str = "writingConventions";
/// Its default value, and the per-language value meaning "no choice".
pub const AUTOMATIC: &str = "automatic";

/// Per language: its key in the setting, the profile Automatic uses (None:
/// universal rules and consistency checks only) and the profiles a user can
/// choose. Mirrored by WRITING_CONVENTIONS in platform/ipc.ts (a test keeps the
/// two the same).
pub const LANGUAGE_PROFILES: &[(Lang, Option<&str>, &[&str])] = &[
    (
        Lang::ZhHans,
        Some("zh-Hans-CN"),
        &[
            "zh-Hans-CN",
            "zh-Hans-CN/tech",
            "zh-Hans-CN/gongwen",
            "zh-Hans-CN/academic",
            "zh-Hans-CN/fiction",
            "zh-Hans-CN/newmedia",
            "zh-Hant-CN",
        ],
    ),
    (
        Lang::ZhHant,
        Some("zh-Hant-TW"),
        &["zh-Hant-TW", "zh-Hant-TW/gongwen", "zh-Hant-HK"],
    ),
    (
        Lang::En,
        None,
        &[
            "en-US/general",
            "en-US/news",
            "en-US/tech-google",
            "en-US/tech-microsoft",
            "en-US/apa",
            "en-US/mla",
            "en-GB/govuk",
            "en-GB/oxford",
            "en-US/army",
            "en-AU",
        ],
    ),
    (
        Lang::Ja,
        Some("ja/jtf"),
        &["ja/jtf", "ja/koyobun", "ja/fiction", "ja/tech"],
    ),
    (Lang::Ko, Some("ko"), &["ko", "ko/official"]),
    (Lang::Es, None, &["es-ES", "es-419", "es/eu"]),
    (Lang::Fr, None, &["fr-FR", "fr-CA", "fr-CH", "fr/eu"]),
    (
        Lang::De,
        None,
        &["de-DE", "de-DE/din5008", "de-AT", "de-CH", "de/eu"],
    ),
    (Lang::Ru, Some("ru"), &["ru", "ru/gost"]),
    (
        Lang::Pt,
        Some("pt-BR"),
        &["pt-BR", "pt-BR/official", "pt-PT", "pt/eu"],
    ),
];

/// Options a profile can override, with their values (the first is the
/// default). Keys as in `.textus/style.md` front matter and in the
/// setting's `options` object.
pub const OPTIONS: &[(&str, &[&str])] = &[
    ("cjk-latin-space", &["auto", "on", "off", "layout"]),
    ("stacked-marks", &["auto", "1", "3"]),
    ("quotes", &["auto", "curly", "corner"]),
    (
        "number-grouping",
        &["auto", "comma", "space", "thin-space", "none"],
    ),
    ("unit-space", &["auto", "on", "off"]),
    ("percent-space", &["auto", "on", "off"]),
    ("fr.spacing", &["auto", "fr-FR", "fr-CA", "fr-CH", "eu"]),
    ("de.dateZeroPad", &["off", "on"]),
    ("de.genderChars", &["allow", "flag"]),
    ("es.soloAccent", &["off", "flag"]),
    ("pt.ao90", &["on", "off"]),
    ("ru.yo", &["selective", "always", "never"]),
];

/// Where the effective profile came from. Generated as ProfileSource (JSON
/// never carries an enum's name).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(test, derive(specta::Type), serde(rename = "ProfileSource"))]
#[serde(rename_all = "camelCase")]
pub enum Source {
    #[default]
    Automatic,
    Settings,
    Project,
}

/// The conventions one document follows, as the rules read them.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// The profile value (`zh-Hans-CN/fiction`), or the language key when
    /// Automatic has no national default (`en`).
    pub id: String,
    pub lang: Lang,
    /// `CN`, `TW`, `HK`, `US`, `GB`, `AU`, `ES`, `419`, `FR`, `CA`, `CH`,
    /// `DE`, `AT`, `BR`, `PT`.
    pub region: Option<String>,
    /// `fiction`, `tech`, `gongwen`, `academic`, `newmedia`, `general`,
    /// `news`, `tech-google`, `tech-microsoft`, `apa`, `mla`, `govuk`,
    /// `oxford`, `army`, `jtf`, `koyobun`, `official`, `eu`, `din5008`,
    /// `gost`.
    pub preset: Option<String>,
    /// Chosen by the user (settings or project) rather than Automatic.
    pub explicit: bool,
    pub source: Source,
    pub options: BTreeMap<String, String>,
}

impl Profile {
    /// Parses a profile value. None for a value that isn't one.
    pub fn parse(value: &str) -> Option<Profile> {
        let value = value.trim();
        let (base, preset) = match value.split_once('/') {
            Some((b, p)) => (b, Some(p.to_string())),
            None => (value, None),
        };
        let parts: Vec<&str> = base.split('-').collect();
        let (lang, region) = match parts.as_slice() {
            ["zh", "Hans", r] => (Lang::ZhHans, Some(*r)),
            ["zh", "Hant", r] => (Lang::ZhHant, Some(*r)),
            ["zh", "Hans"] => (Lang::ZhHans, Some("CN")),
            ["zh", "Hant"] => (Lang::ZhHant, Some("TW")),
            [l] => (Lang::from_code(l)?, None),
            [l, r] => (Lang::from_code(l)?, Some(*r)),
            _ => return None,
        };
        Some(Profile {
            id: value.to_string(),
            lang,
            region: region.map(str::to_string),
            preset,
            explicit: false,
            source: Source::Automatic,
            options: BTreeMap::new(),
        })
    }

    /// The Automatic profile for a language.
    pub fn automatic(lang: Lang) -> Profile {
        let default = LANGUAGE_PROFILES
            .iter()
            .find(|(l, _, _)| *l == lang)
            .and_then(|(_, d, _)| *d);
        match default.and_then(Profile::parse) {
            Some(p) => p,
            None => Profile {
                id: lang.code().to_string(),
                lang,
                region: None,
                preset: None,
                explicit: false,
                source: Source::Automatic,
                options: BTreeMap::new(),
            },
        }
    }

    pub fn is(&self, preset: &str) -> bool {
        self.preset.as_deref() == Some(preset)
    }

    pub fn region_is(&self, region: &str) -> bool {
        self.region.as_deref() == Some(region)
    }

    /// An option's value, when it is set to something other than `auto`.
    pub fn opt(&self, key: &str) -> Option<&str> {
        self.options
            .get(key)
            .map(String::as_str)
            .filter(|v| *v != "auto")
    }

    /// Mainland conventions for Chinese: zh-Hans-CN and zh-Hant-CN.
    pub fn mainland(&self) -> bool {
        self.lang.is_chinese() && self.region.as_deref().unwrap_or("CN") == "CN"
    }

    /// One line for prompts and tool results: the profile, where it came
    /// from, and the options that are set.
    pub fn describe(&self) -> String {
        let source = match self.source {
            Source::Automatic => {
                "Automatic: follows the document's own majority where conventions conflict"
            }
            Source::Settings => "chosen in Settings",
            Source::Project => "from the project's style profile",
        };
        let mut line = format!("{} ({source})", self.id);
        if !self.options.is_empty() {
            let opts: Vec<String> = self
                .options
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect();
            line.push_str(&format!(". {}", opts.join(", ")));
        }
        line
    }
}

/// What `.textus/style.md` says about conventions.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProjectConventions {
    /// The `conventions:` values, in order.
    pub profiles: Vec<String>,
    /// Option keys set in the front matter.
    pub options: BTreeMap<String, String>,
}

impl ProjectConventions {
    /// Reads the front matter of a style profile: a `---` block at the very
    /// top, `key: value` lines at column 0. The rest of the file (and any
    /// key this doesn't know) is the style profile's business.
    pub fn from_style(style: &str) -> ProjectConventions {
        let mut pc = ProjectConventions::default();
        let text = style.trim_start_matches('\u{feff}');
        let Some(rest) = text
            .strip_prefix("---\n")
            .or_else(|| text.strip_prefix("---\r\n"))
        else {
            return pc;
        };
        let Some(end) = rest.find("\n---") else {
            return pc;
        };
        for line in rest[..end].lines() {
            if line.starts_with([' ', '\t']) {
                continue;
            }
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
            let key = key.trim();
            if value.is_empty() {
                continue;
            }
            if key == "conventions" {
                pc.profiles = value
                    .trim_matches(['[', ']'])
                    .split([',', '，', '、'])
                    .map(|v| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                    .filter(|v| !v.is_empty())
                    .collect();
            } else if OPTIONS.iter().any(|(k, _)| *k == key) {
                pc.options.insert(key.to_string(), value.to_string());
            }
        }
        pc
    }
}

/// Everything that decides a document's profile: the global setting and
/// the project's style profile. Cheap to clone; resolved per language.
#[derive(Clone, Debug, Default)]
pub struct Conventions {
    /// The `writingConventions` setting as stored (None: never set).
    pub setting: Option<Value>,
    pub project: ProjectConventions,
}

impl Conventions {
    /// The profile a document (or block) in `lang` follows.
    pub fn profile_for(&self, lang: Lang) -> Profile {
        let matching = |value: &str| Profile::parse(value).filter(|p| p.lang == lang);
        let mut profile =
            if let Some(mut p) = self.project.profiles.iter().find_map(|v| matching(v)) {
                p.explicit = true;
                p.source = Source::Project;
                p
            } else if let Some(mut p) = self.setting_profile(lang) {
                p.explicit = true;
                p.source = Source::Settings;
                p
            } else {
                Profile::automatic(lang)
            };
        // Options: the setting's, then the project's over them.
        if let Some(Value::Object(opts)) = self.setting.as_ref().and_then(|s| s.get("options")) {
            for (k, v) in opts {
                if let (true, Some(v)) = (OPTIONS.iter().any(|(key, _)| key == k), v.as_str()) {
                    profile.options.insert(k.clone(), v.to_string());
                }
            }
        }
        for (k, v) in &self.project.options {
            profile.options.insert(k.clone(), v.clone());
        }
        profile
    }

    fn setting_profile(&self, lang: Lang) -> Option<Profile> {
        // The Settings row stores one profile as a string ("en-GB/govuk"):
        // it applies to documents in its own language, and the others stay
        // Automatic. Several separated by commas work too, as in style.md.
        if let Some(Value::String(s)) = &self.setting {
            return s
                .split(',')
                .map(str::trim)
                .filter(|v| *v != AUTOMATIC)
                .filter_map(Profile::parse)
                .find(|p| p.lang == lang);
        }
        let Some(Value::Object(map)) = &self.setting else {
            return None;
        };
        let parse = |v: &Value| {
            v.as_str()
                .filter(|s| *s != AUTOMATIC)
                .and_then(Profile::parse)
                .filter(|p| p.lang == lang)
        };
        // The language's own key, "zh" for either Chinese script, then any
        // value naming this language (zh-Hant-CN is offered under zh-Hans).
        if let Some(v) = map.get(lang.code()) {
            if v.as_str() == Some(AUTOMATIC) {
                return None;
            }
            if let Some(p) = parse(v) {
                return Some(p);
            }
        }
        if lang.is_chinese() {
            if let Some(p) = map.get("zh").and_then(parse) {
                return Some(p);
            }
        }
        map.iter()
            .filter(|(k, _)| k.as_str() != "options")
            .find_map(|(_, v)| parse(v))
    }
}

/// The allowed values, for the frontend's settings row.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConventionsOptions {
    pub setting_key: &'static str,
    pub automatic: &'static str,
    pub languages: Vec<LanguageOptions>,
    pub options: Vec<OptionValues>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LanguageOptions {
    pub lang: Lang,
    /// The profile Automatic uses for this language, if any.
    pub automatic_profile: Option<&'static str>,
    pub profiles: &'static [&'static str],
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct OptionValues {
    pub key: &'static str,
    pub values: &'static [&'static str],
}

pub fn options() -> ConventionsOptions {
    ConventionsOptions {
        setting_key: SETTING_KEY,
        automatic: AUTOMATIC,
        languages: LANGUAGE_PROFILES
            .iter()
            .map(|(lang, automatic_profile, profiles)| LanguageOptions {
                lang: *lang,
                automatic_profile: *automatic_profile,
                profiles,
            })
            .collect(),
        options: OPTIONS
            .iter()
            .map(|(key, values)| OptionValues { key, values })
            .collect(),
    }
}

#[cfg(test)]
mod tests;
