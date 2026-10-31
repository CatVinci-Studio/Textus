use super::*;

#[test]
fn library_entries_parse_frontmatter_lists_in_both_scripts() {
    let entry = parse_library_entry(
        ".textus/library/lin.md",
        "lin",
        "---\nname: 林晚\naliases: [晚晚, 林老师]\ninclude: always\n---\n女主角。",
    );
    assert_eq!(entry.name, "林晚");
    assert_eq!(entry.aliases, ["晚晚", "林老师"]);
    assert_eq!(entry.include, LibraryInclude::Always);
    assert_eq!(entry.body, "女主角。");
    let plain = parse_library_entry("f", "Harbour", "A port city.");
    assert_eq!(plain.name, "Harbour");
    assert_eq!(plain.include, LibraryInclude::Detected);
}

#[test]
fn learned_profiles_use_the_template_headings() {
    // "Create style profile" writes projectStyleTemplate; "Learn my
    // style" must head its profile the same way in each UI language.
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let instructions = style_instructions();
    let mut checked = 0;
    for language in crate::ai::ui_language::UI_LANGUAGES {
        let code = language.code;
        let strings =
            std::fs::read_to_string(repo.join(format!("src/i18n/locales/{code}.ts"))).unwrap();
        let Some(template) = strings
            .lines()
            .find(|l| l.trim_start().starts_with("projectStyleTemplate:"))
        else {
            // Not translated yet: the English starter, English headings.
            continue;
        };
        let headings = language
            .style_headings()
            .unwrap_or_else(|| panic!("style-headings/{code}.txt is empty"));
        assert_eq!(
            headings.split(" / ").count(),
            8,
            "{code}: a title and seven sections"
        );
        assert!(instructions.contains(&format!("{}: {headings}\n", language.english)));
        for part in template.split("\\n") {
            let part = part.trim_start_matches(|c| c != '#');
            if part.starts_with("# ") || part.starts_with("## ") {
                checked += 1;
                let heading = part.trim_end_matches(['`', ',']);
                assert!(
                    headings.split(" / ").any(|h| h == heading),
                    "{code}: {heading} is not in style-headings/{code}.txt"
                );
            }
        }
    }
    assert!(checked >= 15, "found {checked} headings");
}

#[test]
fn comments_in_library_entries_never_reach_the_model() {
    // The "New library entry…" template explains itself in a comment;
    // left untouched, the entry has no facts and is not an entry.
    let fresh = parse_library_entry(
        "f",
        "lin",
        "---\nname: Lin Wan\ninclude: detected\n---\n\n<!-- Facts to keep consistent. -->\n",
    );
    assert_eq!(fresh.body, "");
    let noted = parse_library_entry(
        "f",
        "lin",
        "---\nname: Lin Wan\n---\n<!-- note to self -->\nTeaches Chinese.",
    );
    assert_eq!(noted.body, "Teaches Chinese.");
}

#[test]
fn only_mentioned_or_always_entries_are_relevant() {
    let lib = vec![
        parse_library_entry("a", "a", "---\nname: 林晚\naliases: [晚晚]\n---\n女主角。"),
        parse_library_entry("b", "b", "---\nname: Harbour\n---\nA port."),
        parse_library_entry(
            "c",
            "c",
            "---\nname: Rules\ninclude: always\n---\nNo magic.",
        ),
        parse_library_entry("d", "d", "---\nname: Secret\ninclude: never\n---\nHidden."),
    ];
    let names: Vec<_> = relevant_library(&lib, "晚晚走进教室，Secret 不该出现")
        .iter()
        .map(|e| e.name.clone())
        .collect();
    assert_eq!(names, ["林晚", "Rules"]);
}

fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (path, body) in files {
        let full = dir.path().join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, body).unwrap();
    }
    dir
}

#[test]
fn walking_skips_hidden_and_build_folders_and_reads_safely() {
    let dir = project(&[
        ("notes/a.md", "alpha beta"),
        ("b.txt", "Beta gamma"),
        (".secret/key.md", "beta"),
        ("node_modules/x.md", "beta"),
        ("image.png", "beta"),
    ]);
    let dir = dir.path();
    assert_eq!(walk_text_files(dir).files, ["notes/a.md", "b.txt"]);
    let found = search(dir, "beta");
    assert_eq!(found, "notes/a.md:1: alpha beta\nb.txt:1: Beta gamma");
    assert!(read_text(dir, ".secret/key.md").is_err());
    assert!(read_text(dir, "../etc/passwd").is_err());
    assert_eq!(read_text(dir, "@notes/a.md").unwrap(), "alpha beta");
}

#[test]
fn the_project_walk_follows_gitignore_like_the_sidebar() {
    let dir = project(&[
        (".gitignore", "drafts/\n"),
        ("drafts/old.md", "beta"),
        ("notes.md", "beta"),
    ]);
    assert_eq!(walk_text_files(dir.path()).files, ["notes.md"]);
    assert_eq!(search(dir.path(), "beta"), "notes.md:1: beta");
    assert!(find(dir.path(), "old", false).starts_with("No file"));
}

#[test]
fn search_returns_the_first_matches_in_walk_order_and_says_it_stopped() {
    let files: Vec<(String, String)> = (0..60)
        .map(|i| (format!("ch{i}.md"), "beta\nbeta".to_string()))
        .collect();
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, b)| (p.as_str(), b.as_str()))
        .collect();
    let dir = project(&refs);
    let first = search(dir.path(), "beta");
    let lines: Vec<&str> = first.lines().collect();
    assert_eq!(lines.len(), MAX_SEARCH_MATCHES + 1);
    assert_eq!(lines[0], "ch0.md:1: beta");
    assert_eq!(lines[2], "ch1.md:1: beta");
    assert_eq!(lines[39], "ch19.md:2: beta");
    assert_eq!(lines[40], "... (stopped at 40 matches)");
    for _ in 0..5 {
        assert_eq!(search(dir.path(), "beta"), first);
    }
}

#[test]
fn search_skips_files_too_large_or_not_text() {
    let huge = format!("beta {}", "x".repeat(MAX_TEXT_BYTES as usize));
    let dir = project(&[
        ("huge.md", &huge),
        ("nul.txt", "beta\0"),
        ("small.md", "beta"),
    ]);
    std::fs::write(
        dir.path().join("binary.txt"),
        [b'b', b'e', b't', b'a', b'\n', 0xff, 0xfe],
    )
    .unwrap();
    assert_eq!(search(dir.path(), "beta"), "small.md:1: beta");
    assert!(read_part(dir.path(), "huge.md", LineRange::default())
        .unwrap_err()
        .contains("too large to read (16.0 MB; the limit is 16.0 MB)"));
    assert!(read_part(dir.path(), "nul.txt", LineRange::default())
        .unwrap_err()
        .contains("isn't a readable text file"));
}

/// A book in one file, past MAX_FILE_BYTES: read_file shows it in parts and
/// search_files points into it by line, numbered as read_file numbers them.
#[test]
fn a_big_file_reads_in_parts_and_search_points_into_it() {
    let book: String = (1..=6_000)
        .map(|n| {
            if n == 4_321 {
                "The lighthouse keeper's name was Abel Mora.\n".to_string()
            } else {
                format!("Line {n} of the long manuscript, nothing to see here.\n")
            }
        })
        .collect();
    assert!(book.len() as u64 > MAX_FILE_BYTES);
    let dir = project(&[("book.md", &book)]);
    let root = dir.path();
    assert!(
        read_text(root, "book.md").is_err(),
        "an @-mention still can't"
    );

    let first = read_part(root, "book.md", LineRange::default()).unwrap();
    let header = first.lines().next().unwrap();
    assert!(header.starts_with("`book.md`, lines 1-"), "{header}");
    assert!(header.ends_with("of 6000:"), "{header}");
    let shown: usize = header["`book.md`, lines 1-".len()..]
        .split(' ')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert!(first.chars().count() <= MAX_READ_UNITS + 200);
    assert!(first.ends_with(&format!(
            "[... {} more lines not shown - read on with start_line={}, or read the lines around a match search_files found]",
            6_000 - shown,
            shown + 1
        )));

    let next = read_part(
        root,
        "book.md",
        LineRange {
            start: Some(shown + 1),
            end: None,
        },
    )
    .unwrap();
    assert!(next.starts_with(&format!("`book.md`, lines {}-", shown + 1)));
    assert!(next.contains("[... cut for length - continue with start_line="));

    assert_eq!(
        search(root, "abel mora"),
        "book.md:4321: The lighthouse keeper's name was Abel Mora."
    );
    let around = read_part(
        root,
        "book.md",
        LineRange {
            start: Some(4_320),
            end: Some(4_322),
        },
    )
    .unwrap();
    assert_eq!(
            around,
            "`book.md`, lines 4320-4322 of 6000:\nLine 4320 of the long manuscript, nothing to see here.\nThe lighthouse keeper's name was Abel Mora.\nLine 4322 of the long manuscript, nothing to see here."
        );
}

#[test]
fn a_read_counts_chinese_characters_by_weight() {
    let line = "灯塔看守人的名字叫阿贝尔，他每天傍晚都会爬上那段螺旋楼梯。".repeat(4);
    let text = format!("{line}\n").repeat(400);
    let dir = project(&[("书.md", &text)]);
    let out = read_part(dir.path(), "书.md", LineRange::default()).unwrap();
    let cjk = out.chars().filter(|&c| char_units(c) == 3).count();
    assert!((12_000..=MAX_READ_UNITS / 3).contains(&cjk), "{cjk}");
    assert!(out.contains("more lines not shown"));
}

#[test]
fn a_line_longer_than_a_read_shows_its_beginning() {
    let dir = project(&[("one-line.txt", &"word ".repeat(20_000))]);
    let out = read_part(dir.path(), "one-line.txt", LineRange::default()).unwrap();
    assert!(out.starts_with("`one-line.txt`, lines 1-1 of 1:\nword word"));
    assert!(out.ends_with("[... line 1 is longer than one read can show; this is its beginning]"));
    assert!(out.len() < MAX_READ_UNITS + 200);
}

#[test]
fn a_small_file_reads_whole_and_a_range_says_where_it_is() {
    let dir = project(&[("a.md", "one\ntwo\nthree\n"), ("empty.md", "")]);
    let whole = read_part(dir.path(), "@a.md", LineRange::default()).unwrap();
    assert_eq!(whole, "one\ntwo\nthree\n");
    let range = LineRange {
        start: Some(2),
        end: Some(9),
    };
    assert_eq!(
        read_part(dir.path(), "a.md", range).unwrap(),
        "`a.md`, lines 2-3 of 3:\ntwo\nthree"
    );
    assert_eq!(
        read_part(dir.path(), "empty.md", range).unwrap(),
        "`empty.md` is empty."
    );
    assert!(read_part(dir.path(), ".", range)
        .unwrap_err()
        .contains("is a folder"));
}

#[test]
fn documents_are_listed_read_and_searched_as_their_text() {
    let dir = project(&[
        ("notes.md", "Harbour notes."),
        ("broken.pdf", "%PDF-1.4 no"),
    ]);
    std::fs::create_dir_all(dir.path().join("research")).unwrap();
    std::fs::write(
        dir.path().join("research/interview.docx"),
        crate::extract::test_docx(&["Maria Lopez, 12 March", "She takes the 6:40 bus."]),
    )
    .unwrap();
    std::fs::write(dir.path().join("map.png"), [0x89, b'P', b'N', b'G']).unwrap();
    let root = dir.path();
    assert_eq!(
        walk_readable_files(root, false).files,
        ["research/interview.docx", "broken.pdf", "notes.md"]
    );
    assert_eq!(walk_text_files(root).files, ["notes.md"]);
    assert_eq!(
        read_part(root, "research/interview.docx", LineRange::default()).unwrap(),
        "Maria Lopez, 12 March\n\nShe takes the 6:40 bus."
    );
    assert_eq!(
        read_part(
            root,
            "research/interview.docx",
            LineRange {
                start: Some(3),
                end: None
            },
        )
        .unwrap(),
        "`research/interview.docx`, lines 3-3 of 3:\nShe takes the 6:40 bus."
    );
    assert_eq!(
        search(root, "6:40"),
        "research/interview.docx:3: She takes the 6:40 bus."
    );
    assert_eq!(
        read_part(root, "broken.pdf", LineRange::default()).unwrap_err(),
        "`broken.pdf` can't be read: This PDF can't be read."
    );
    assert_eq!(find(root, "interview", false), "research/interview.docx");
}

#[test]
fn images_are_listed_and_shown_only_to_a_model_that_can_see() {
    let dir = project(&[("notes.md", "")]);
    let root = dir.path();
    std::fs::write(root.join("map.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(
        root.join("poster.jpg"),
        vec![0u8; crate::extract::MAX_IMAGE_BYTES as usize + 1],
    )
    .unwrap();
    assert_eq!(walk_readable_files(root, false).files, ["notes.md"]);
    assert_eq!(
        walk_readable_files(root, true).files,
        ["map.png", "notes.md", "poster.jpg"]
    );
    assert_eq!(find(root, "map", true), "map.png (image)");
    assert!(find(root, "map", false).starts_with("No file"));

    let image = read_image(root, "map.png").unwrap();
    assert_eq!(
        (image.name.as_str(), image.mime.as_str()),
        ("map.png", "image/png")
    );
    assert_eq!(image.data_base64, "iVBORw==");
    assert_eq!(
            read_image(root, "poster.jpg").unwrap_err(),
            "`poster.jpg` is too large to show (6.0 MB; the limit is 6.0 MB), and Textus can't make images smaller - ask the user for a smaller copy."
        );
    assert!(read_image(root, "notes.md")
        .unwrap_err()
        .starts_with("`notes.md` isn't an image"));
    assert!(read_image(root, "../map.png").is_err());
    assert!(read_part(root, "map.png", LineRange::default())
        .unwrap_err()
        .contains("can't see images"));
}

#[test]
fn a_document_is_extracted_once_per_version() {
    let dir = project(&[]);
    let path = dir.path().join("a.docx");
    std::fs::write(&path, crate::extract::test_docx(&["first"])).unwrap();
    let once = document_text(&path).unwrap();
    assert!(Arc::ptr_eq(&once, &document_text(&path).unwrap()));
    std::fs::write(&path, crate::extract::test_docx(&["second", "version"])).unwrap();
    assert_eq!(document_text(&path).unwrap().as_str(), "second\n\nversion");
}

#[test]
fn search_stops_when_the_time_is_up() {
    let dir = project(&[("a.md", "beta")]);
    let files = vec!["a.md".to_string()];
    let found = search_in_order(dir.path(), &files, "beta", Instant::now());
    assert_eq!(found.read, 0);
    assert!(found.hits.is_empty());
}

#[test]
fn find_lists_documents_first_and_names_before_paths() {
    let dir = project(&[
        ("data/chapter-3.json", "{}"),
        ("drafts/Chapter 3.md", ""),
        ("chapter-3/notes.md", ""),
        ("old-chapter-3.txt", ""),
        ("chapter-13.md", ""),
    ]);
    assert_eq!(
            find(dir.path(), "chapter 3", false),
            "drafts/Chapter 3.md\nold-chapter-3.txt\nchapter-3/notes.md\nchapter-13.md\ndata/chapter-3.json"
        );
    assert_eq!(find(dir.path(), "  ", false), "No name provided.");
}

#[test]
fn find_caps_its_answer() {
    let files: Vec<(String, &str)> = (0..60).map(|i| (format!("note-{i}.md"), "")).collect();
    let refs: Vec<(&str, &str)> = files.iter().map(|(p, b)| (p.as_str(), *b)).collect();
    let dir = project(&refs);
    let found = find(dir.path(), "NOTE", false);
    let lines: Vec<&str> = found.lines().collect();
    assert_eq!(lines.len(), MAX_FOUND_FILES + 1);
    assert_eq!(lines[0], "note-0.md");
    assert_eq!(
        lines[MAX_FOUND_FILES],
        "... (10 more - give more of the name)"
    );
}

#[test]
fn the_library_and_style_are_read_from_textus_only() {
    let dir = std::env::temp_dir().join(format!("textus-lib-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, body) in [
        (".other/library/wu.md", "---\nname: Wu\n---\nOther Wu."),
        (".other/style.md", "Short sentences."),
        (".textus/library/lin.md", "---\nname: Lin\n---\nTextus Lin."),
        (
            ".textus/library/new.md",
            "---\nname: New\n---\n<!-- what to know about New -->\n",
        ),
    ] {
        let full = dir.join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, body).unwrap();
    }
    let library = read_library(&dir);
    let bodies: Vec<_> = library.iter().map(|e| e.body.as_str()).collect();
    assert_eq!(bodies, ["Textus Lin.", ""]);
    assert_eq!(library[0].file, ".textus/library/lin.md");
    // Listed, but never sent: nothing is written in it yet.
    assert!(relevant_library(&library, "New and Lin")
        .iter()
        .all(|e| e.name != "New"));
    assert_eq!(read_style(&dir), None);
    // "Learn my style" and "Open style profile" write .textus/style.md.
    assert_eq!(style_path(&dir), dir.join(".textus/style.md"));
    std::fs::write(dir.join(".textus/style.md"), "Long sentences.").unwrap();
    assert_eq!(read_style(&dir).as_deref(), Some("Long sentences."));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_library_cap_counts_characters_and_names_what_it_left_out() {
    // 3,000 Chinese characters are 9,000 bytes: two such entries fit
    // in 8,000 characters' worth only one at a time.
    let body = "林".repeat(3_000);
    let lib: Vec<_> = ["甲", "乙", "丙"]
        .iter()
        .map(|n| {
            parse_library_entry(
                n,
                n,
                &format!("---\nname: {n}{n}\ninclude: always\n---\n{body}"),
            )
        })
        .collect();
    let pick = pick_library(&lib, "");
    assert_eq!(pick.included.len(), 2, "6,000 of 8,000 characters");
    assert_eq!(pick.left_out.len(), 1);
    assert_eq!(pick.left_out[0].name, "丙丙");
}

/// How long the project tools take on a real folder:
/// `TEXTUS_PROJECT_BENCH=<dir> cargo test --release project_tools_benchmark -- --ignored --nocapture`.
#[test]
#[ignore]
fn project_tools_benchmark() {
    let Some(dir) = std::env::var_os("TEXTUS_PROJECT_BENCH") else {
        return;
    };
    let root = PathBuf::from(dir);
    let words = std::env::var("TEXTUS_PROJECT_BENCH_WORDS")
        .unwrap_or_else(|_| "zebracorn,harbour,note 4".into());
    let [rare, common, name] = words.splitn(3, ',').collect::<Vec<_>>()[..] else {
        panic!("TEXTUS_PROJECT_BENCH_WORDS is <rare>,<common>,<name>");
    };
    let timed = |what: &str, out: &dyn Fn() -> String| {
        let start = Instant::now();
        let out = out();
        println!(
            "{what}: {:?}, {} lines, last: {}",
            start.elapsed(),
            out.lines().count(),
            out.lines().last().unwrap_or_default()
        );
    };
    for rel in walk_readable_files(&root, false).files {
        let path = root.join(&rel);
        if file_kind(&path) != Some(FileKind::Document) {
            continue;
        }
        let ext = crate::extract::extension_of(&path);
        let start = Instant::now();
        let text = crate::extract::document_text(&path, &ext).unwrap();
        println!(
            "extract {rel} ({} KB): {:?}, {} characters",
            size_of(&path) / 1024,
            start.elapsed(),
            text.map_or(0, |t| t.chars().count())
        );
    }
    // The first round extracts every document; the later ones read
    // them from the cache.
    for _ in 0..3 {
        let start = Instant::now();
        let walked = walk_readable_files(&root, false);
        println!(
            "walk: {:?}, {} text files, truncated {}",
            start.elapsed(),
            walked.files.len(),
            walked.truncated
        );
        timed("search, rare word", &|| search(&root, rare));
        timed("search, common word", &|| search(&root, common));
        timed("find", &|| find(&root, name, false));
    }
}

#[test]
fn filesystem_root_is_too_broad() {
    assert!(is_too_broad(Path::new("/")));
    assert!(!is_too_broad(
        &std::env::temp_dir().join("textus-some-project")
    ));
}

#[test]
fn reference_terms_are_words_and_cjk_pairs() {
    assert_eq!(terms("Tidal-power, 2021 a"), ["tidal", "power", "2021"]);
    assert_eq!(
        terms("潮汐能发电 GPU"),
        ["潮", "潮汐", "汐能", "能发", "发电", "gpu"]
    );
}

#[test]
fn references_rank_the_passage_with_most_of_the_words_first() {
    let filler = "Unrelated words about gardens and weather.\n".repeat(40);
    let dir = project(&[
        (
            "references/a.md",
            &format!("{filler}Tidal barrages store energy at high tide.\n"),
        ),
        ("references/notes/b.txt", "Wind turbines make energy.\n"),
        ("references/c.md", "潮汐能是一种可再生能源。\n"),
        ("elsewhere.md", "Tidal barrages everywhere.\n"),
    ]);
    let out = search_references(dir.path(), "tidal barrage energy barrages");
    let first = out.split("\n\n").next().unwrap();
    assert!(first.starts_with("references/a.md:"), "{out}");
    assert!(first.contains("Tidal barrages store energy"), "{out}");
    assert!(out.contains("references/notes/b.txt:1-1"), "{out}");
    assert!(!out.contains("elsewhere"), "{out}");
    assert!(search_references(dir.path(), "潮汐能").starts_with("references/c.md:1-1"));
    assert!(search_references(dir.path(), "volcano").starts_with("No passage"));

    // A changed file is indexed again; a deleted one is gone.
    std::fs::write(
        dir.path().join("references/notes/b.txt"),
        "Volcano notes.\n",
    )
    .unwrap();
    std::fs::remove_file(dir.path().join("references/c.md")).unwrap();
    assert!(search_references(dir.path(), "volcano").starts_with("references/notes/b.txt"));
    assert!(search_references(dir.path(), "潮汐能").starts_with("No passage"));
}

#[test]
fn without_a_references_folder_the_search_says_where_they_go() {
    let dir = project(&[("a.md", "Tides.")]);
    assert!(search_references(dir.path(), "tides").contains("no `references/` folder"));
}
