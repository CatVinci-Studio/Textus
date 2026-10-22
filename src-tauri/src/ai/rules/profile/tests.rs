use super::*;
use serde_json::json;

#[test]
fn every_offered_profile_parses_to_its_language() {
    for (lang, auto, profiles) in LANGUAGE_PROFILES {
        for p in *profiles {
            let parsed = Profile::parse(p).unwrap_or_else(|| panic!("{p}"));
            // zh-Hant-CN (GB rules, Traditional characters) is offered
            // with the mainland profiles.
            if *p != "zh-Hant-CN" {
                assert_eq!(parsed.lang, *lang, "{p}");
            }
        }
        if let Some(a) = auto {
            assert!(profiles.contains(a));
        }
    }
    let p = Profile::parse("zh-Hans-CN/fiction").unwrap();
    assert_eq!(
        (p.region.as_deref(), p.preset.as_deref()),
        (Some("CN"), Some("fiction"))
    );
    let p = Profile::parse("ja/koyobun").unwrap();
    assert_eq!(
        (p.lang, p.region.clone(), p.is("koyobun")),
        (Lang::Ja, None, true)
    );
    assert!(Profile::parse("xx-YY").is_none());
    assert!(Profile::parse("zh-Hant-CN").unwrap().mainland());
    assert!(!Profile::parse("zh-Hant-TW").unwrap().mainland());
}

#[test]
fn the_frontend_list_mirrors_this_one() {
    let ipc = include_str!("../../../../../src/platform/ipc-ai-types.ts");
    let start = ipc.find("export const WRITING_CONVENTIONS:").unwrap();
    let block = &ipc[start..start + ipc[start..].find("\n};").unwrap()];
    for (lang, auto, profiles) in LANGUAGE_PROFILES {
        let key = format!("\"{}\"", lang.code());
        let bare = format!("\n  {}:", lang.code());
        let at = block
            .find(&format!("{key}:"))
            .or_else(|| block.find(&bare))
            .unwrap_or_else(|| panic!("{} missing in platform/ipc-ai-types.ts", lang.code()));
        let entry = &block[at..];
        let entry = &entry[..entry.find("},").map_or(entry.len(), |e| e + 2)];
        match auto {
            Some(a) => assert!(entry.contains(&format!("automatic: \"{a}\"")), "{entry}"),
            None => assert!(entry.contains("automatic: null"), "{entry}"),
        }
        let list = &entry[entry.find("profiles: [").unwrap()..];
        let list = &list[..list.find(']').unwrap()];
        let listed: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
        assert_eq!(listed, *profiles, "{}", lang.code());
    }
    assert!(ipc.contains(&format!("WRITING_CONVENTIONS_KEY = \"{SETTING_KEY}\"")));
    assert!(ipc.contains(&format!("WRITING_CONVENTIONS_AUTOMATIC = \"{AUTOMATIC}\"")));
}

#[test]
fn style_front_matter_sets_profiles_and_options() {
    let style = "---\nconventions: zh-Hans-CN/fiction, en-GB/oxford\ncjk-latin-space: on\nunknown: x\n  quotes: corner\n---\n# Voice\nShort sentences.";
    let pc = ProjectConventions::from_style(style);
    assert_eq!(pc.profiles, ["zh-Hans-CN/fiction", "en-GB/oxford"]);
    assert_eq!(
        pc.options.get("cjk-latin-space").map(String::as_str),
        Some("on")
    );
    // Indented and unknown keys are not options.
    assert_eq!(pc.options.len(), 1);
    assert_eq!(
        ProjectConventions::from_style("# No front matter\nconventions: fr-CA"),
        ProjectConventions::default()
    );
}

#[test]
fn project_beats_settings_beats_automatic() {
    let mut c = Conventions::default();
    let auto = c.profile_for(Lang::ZhHans);
    assert_eq!(
        (auto.id.as_str(), auto.explicit, auto.source),
        ("zh-Hans-CN", false, Source::Automatic)
    );
    assert_eq!(c.profile_for(Lang::En).id, "en");
    assert_eq!(c.profile_for(Lang::Pt).id, "pt-BR");

    c.setting = Some(json!("automatic"));
    assert!(!c.profile_for(Lang::Fr).explicit);
    // The Settings row's single profile: its language only.
    c.setting = Some(json!("en-GB/govuk"));
    let en = c.profile_for(Lang::En);
    assert_eq!(
        (en.id.as_str(), en.source),
        ("en-GB/govuk", Source::Settings)
    );
    assert!(!c.profile_for(Lang::ZhHans).explicit);
    c.setting = Some(
        json!({ "zh": "zh-Hans-CN/tech", "fr": "fr-CA", "en": "automatic", "options": { "quotes": "corner", "bogus": "x" } }),
    );
    let zh = c.profile_for(Lang::ZhHans);
    assert_eq!(
        (zh.id.as_str(), zh.source),
        ("zh-Hans-CN/tech", Source::Settings)
    );
    assert_eq!(zh.opt("quotes"), Some("corner"));
    assert!(!zh.options.contains_key("bogus"));
    assert_eq!(c.profile_for(Lang::Fr).id, "fr-CA");
    assert!(!c.profile_for(Lang::En).explicit);
    // A Traditional document doesn't take the Simplified choice.
    assert_eq!(c.profile_for(Lang::ZhHant).id, "zh-Hant-TW");

    c.project = ProjectConventions::from_style(
        "---\nconventions: zh-Hans-CN/fiction\nquotes: curly\n---\n",
    );
    let zh = c.profile_for(Lang::ZhHans);
    assert_eq!(
        (zh.id.as_str(), zh.source),
        ("zh-Hans-CN/fiction", Source::Project)
    );
    assert_eq!(zh.opt("quotes"), Some("curly"));
    // The project names no French profile: the setting still applies.
    assert_eq!(c.profile_for(Lang::Fr).source, Source::Settings);
}
