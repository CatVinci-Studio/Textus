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
fn the_core_skills_are_built_in_and_the_rest_optional() {
    for name in CORE_SKILLS {
        assert!(find(name).is_some(), "{name}");
    }
    let optional = optional_skill_names();
    assert_eq!(optional.len() + CORE_SKILLS.len(), skills().len());
    assert!(!optional.contains(&"proofread"));
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
            assert!(!text.contains("Textus"), "{stem}: names no product");
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
            assert!(!text.contains("Textus"), "{stem}: names no product");
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
                    PACK_LANGUAGES
                        .iter()
                        .any(|(code, _, _)| pack(&format!("standards-{code}"))
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
        ("academic-humanizer", "Copyright (c) 2026 AIScientists-Dev"),
    ];
    for (source, line) in needs {
        if sources.contains(source) {
            assert!(
                ATTRIBUTION.contains(line),
                "ATTRIBUTION.md credits {source}"
            );
        }
    }
    assert!(
        ATTRIBUTION.contains("W3C Software and Document License")
            && ATTRIBUTION.contains(
                "Title to copyright in this work will at all times remain with copyright holders"
            )
    );
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
        detect("El programa comienza a las nueve y la sesión dura una hora con los participantes."),
        Some("es")
    );
    assert_eq!(detect("Le programme commence à neuf heures et la session dure une heure pour les participants."), Some("fr"));
    assert_eq!(
        detect("Die Sitzung beginnt um neun Uhr und dauert eine Stunde für die Teilnehmer."),
        Some("de")
    );
    assert_eq!(
        detect("A sessão começa às nove horas e não termina antes das dez para os participantes."),
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
        notice.contains("### standards-ko#official") && !notice.contains("standards-ko#numbers")
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
fn academic_polish_covers_grants_with_its_notice_kept_out_of_the_prompt() {
    let skill = find("academic-polish").expect("academic-polish is built in");
    assert_eq!(skill.category.as_deref(), Some("format"));
    assert_eq!(skill.invocation, Invocation::Both, "offered to the model");
    assert!(skill.packs.contains(&"standards#ai-tells".to_string()));
    // The MIT notice travels with the file (and a Customize… copy) as
    // YAML comments, which cost the model nothing.
    let raw = raw("academic-polish").unwrap();
    assert!(raw.contains("# Copyright (c) 2026 AIScientists-Dev"));
    assert!(raw.contains("# Permission is hereby granted"));
    assert!(!skill.prompt.contains("AIScientists") && !skill.description.contains('#'));
    // Its rules on what never changes, and that it isn't for hiding
    // AI use, reach the model.
    for rule in [
        "cite key",
        "Grant proposals",
        "国自然申请书",
        "English only: no em dashes",
        "never change, drop, merge or reorder",
        "AI-use disclosure",
    ] {
        assert!(skill.prompt.contains(rule), "{rule}");
    }
    let skills: Vec<AgentSkill> = skills().to_vec();
    for typed in [
        "/academic-polish",
        "/学术润色",
        "/基金申请书",
        "/förderantrag",
    ] {
        let message = expand_message(&format!("{typed} 立项依据"), &skills, "", "zh");
        assert!(
            message.starts_with("<skill name=\"academic-polish\">\n"),
            "{typed}"
        );
    }
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
        numbers.contains("Simplified Chinese") && numbers.contains("### standards-zh-hans#numbers")
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
