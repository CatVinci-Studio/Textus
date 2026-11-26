//! Generates the TypeScript bindings from commands marked
//! `#[cfg_attr(test, specta::specta)]` and types marked
//! `#[cfg_attr(test, derive(specta::Type))]`; u64 counts are exported as `number`.

use specta_typescript::Typescript;
use std::path::PathBuf;
use tauri_specta::{Builder, ErrorHandlingMode};

mod ai;
mod ai_agent;
mod ai_conventions;
mod ai_memory;
mod ai_paper;
mod ai_project;
mod ai_skills;
mod app;
mod auth;
mod files;
mod plugin_access;
mod plugins;
mod schedule;

const HEADER: &str = "// Generated from the Rust commands by src-tauri/src/bindings.rs - do not\n\
// edit. `npm run bindings` writes it again; `cargo test` fails while it\n\
// is out of date.\n";

/// One generated file: its name and its commands.
type Group = (&'static str, Builder<tauri::Wry>);

/// Every generated file, each listed in its own module.
fn groups() -> Vec<Group> {
    vec![
        files::group(),
        app::group(),
        auth::group(),
        plugins::group(),
        plugin_access::group(),
        schedule::group(),
        // The AI commands, a file per concern (generated files are held to the same
        // 600-line limit).
        ai::group(),
        ai_agent::group(),
        ai_paper::group(),
        ai_project::group(),
        ai_skills::group(),
        ai_memory::group(),
        ai_conventions::group(),
    ]
}

fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        .error_handling(ErrorHandlingMode::Throw)
        // The accessors are the commands' own names, so tsc checks the names the
        // frontend passes.
        .function_casing(tauri_specta::Casing::SnakeCase)
        .dangerously_cast_bigints_to_number()
}

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/platform/bindings")
}

/// What `builder` generates for one group, with our header.
fn generate(builder: &Builder<tauri::Wry>) -> String {
    let scratch = tempfile::NamedTempFile::new().expect("a scratch file");
    builder
        .export(Typescript::default().header(HEADER), scratch.path())
        .expect("bindings export");
    std::fs::read_to_string(scratch.path()).expect("the exported bindings")
}

#[test]
fn bindings_are_current() {
    let write = std::env::var_os("TEXTUS_WRITE_BINDINGS").is_some();
    let mut stale = Vec::new();
    for (name, builder) in groups() {
        let path = dir().join(name);
        let generated = generate(&builder);
        if std::fs::read_to_string(&path).ok().as_deref() == Some(generated.as_str()) {
            continue;
        }
        if write {
            std::fs::write(&path, generated).expect("write bindings");
        } else {
            stale.push(name);
        }
    }
    assert!(
        stale.is_empty(),
        "src/platform/bindings/{stale:?} out of date with the Rust commands: run `npm run bindings`"
    );
}
