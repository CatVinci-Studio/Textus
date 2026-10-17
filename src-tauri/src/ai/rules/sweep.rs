//! What the engine finds in the app's own prose - the help guides in ten
//! languages and the live eval's documents: a false-positive check to run
//! by hand after changing a rule (`cargo test --lib sweep -- --ignored
//! --nocapture`, `SWEEP_LEVEL=strict` for the P2 rules too).

#[test]
#[ignore = "a manual false-positive sweep - see module docs"]
fn sweep_real_prose() {
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir("../src/help")
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .collect();
    files.extend(
        std::fs::read_dir("src/ai/live_eval/docs")
            .unwrap()
            .flatten()
            .map(|e| e.path()),
    );
    files.sort();
    let conv = super::Conventions::default();
    let level = match std::env::var("SWEEP_LEVEL").as_deref() {
        Ok("strict") => super::Level::Strict,
        _ => super::Level::Standard,
    };
    for f in files {
        let doc = std::fs::read_to_string(&f).unwrap();
        let r = super::check_document(&doc, &conv, level, &[]);
        for x in &r.findings {
            println!(
                "{} L{} [{}] {:?} -> {:?} | {}",
                f.file_name().unwrap().to_string_lossy(),
                x.line.unwrap(),
                x.rule,
                x.original,
                x.suggestion,
                x.message
            );
        }
    }
}
