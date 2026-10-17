//! The project folder (in code, the workspace root) seen as writing
//! material - see docs/design/ai-concepts.md. One place for walking it, reading
//! from it safely, searching it, and the two writing aids that live in its
//! `.textus/` directory:
//!
//! ```text
//! my-novel/
//! ├── chapter-1.md
//! └── .textus/
//!     ├── style.md            <- the author's style profile ("Learn my style")
//!     └── library/
//!         ├── lin-wan.md      <- one entry per character, place or term
//!         └── harbour-city.md
//! ```
//!
//! A library entry is markdown with an optional frontmatter block:
//!
//! ```text
//! ---
//! name: Lin Wan
//! aliases: [Wan, Ms Lin]
//! include: detected        # always | detected (default) | never
//! ---
//! Protagonist, 32, teaches Chinese at a secondary school...
//! ```
//!
//! Entries go to the model only when they matter: `always`, or `detected` -
//! the name or an alias appears in what the request is about. Undetected
//! entries cost nothing, so a large library stays cheap. As in agent.md,
//! `<!-- -->` comments in the style profile and in entries are notes to
//! self and never reach the model.

use crate::ai::workspace::{
    project_dir, project_file, project_read_dirs, strip_html_comments, writable_project_file,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Directories that are never writing material: build output, dependency
/// trees, version control. Skipping them keeps a project folder that also
/// holds code from drowning every listing.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    "venv",
    ".venv",
];

/// Extensions read as text by listing, search and @-mentions.
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "rst", "org", "tex", "csv", "tsv", "json", "yaml", "yml",
    "toml", "html", "htm", "xml",
];

const MAX_FILE_BYTES: u64 = 100 * 1024;
const MAX_WALKED_FILES: usize = 2000;
const MAX_SEARCH_MATCHES: usize = 40;
const MAX_LIBRARY_CHARS: usize = 8_000;
const MAX_STYLE_CHARS: usize = 6_000;

/// A folder too broad to hand to the agent as a project: the filesystem
/// root or the home directory. Everything under it would be one guessed
/// path away from the provider.
pub fn is_too_broad(path: &Path) -> bool {
    let canon = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if canon.parent().is_none() {
        return true;
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .and_then(|home| home.canonicalize().ok())
        .is_some_and(|home| home == canon)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| TEXT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Every text file under `root` (relative paths, sorted, depth-first),
/// skipping hidden entries and SKIPPED_DIRS. Bounded: a huge tree stops at
/// MAX_WALKED_FILES rather than stalling the request.
pub fn walk_text_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        // Reverse so the stack pops subfolders in name order.
        let mut subdirs = Vec::new();
        for path in paths {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if is_hidden(name) {
                continue;
            }
            if path.is_dir() {
                if !SKIPPED_DIRS.contains(&name) {
                    subdirs.push(path);
                }
            } else if is_text_file(&path) {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
                if out.len() >= MAX_WALKED_FILES {
                    return out;
                }
            }
        }
        pending.extend(subdirs.into_iter().rev());
    }
    out
}

/// Reads `rel` from inside `root`: canonical containment (no `..`, absolute
/// paths or symlinks out), no hidden components, text only, size-capped.
pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let rel = rel.trim().trim_start_matches('@');
    if rel.is_empty() {
        return Err("No path provided.".to_string());
    }
    let (Ok(root_canon), Ok(path)) = (root.canonicalize(), root.join(rel).canonicalize()) else {
        return Err(format!(
            "`{rel}` doesn't exist. Use list_files to see what's available."
        ));
    };
    if !path.starts_with(&root_canon) {
        return Err(
            "That path is outside the project folder - only files inside it can be read."
                .to_string(),
        );
    }
    // list_files never shows hidden entries, and nothing a writing task needs
    // lives in them - but a project in ~ would otherwise put .ssh, .env or
    // .aws/credentials one guessed path (or one injected instruction) away
    // from being sent to the provider.
    let hidden = path
        .strip_prefix(&root_canon)
        .unwrap_or(&path)
        .components()
        .any(|c| is_hidden(&c.as_os_str().to_string_lossy()));
    if hidden {
        return Err(
            "Hidden files and folders (names starting with \".\") can't be read.".to_string(),
        );
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => Err(format!("`{rel}` is a folder, not a file.")),
        Ok(meta) if meta.len() > MAX_FILE_BYTES => Err(format!(
            "`{rel}` is too large to read ({} KB; the limit is {} KB).",
            meta.len() / 1024,
            MAX_FILE_BYTES / 1024
        )),
        _ => std::fs::read_to_string(&path)
            .map_err(|_| format!("`{rel}` isn't a readable text file.")),
    }
}

/// Case-insensitive line search across the project's text files, as
/// `path:line: text`. Capped so a common word can't flood the context.
pub fn search(root: &Path, query: &str) -> String {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return "No query provided.".to_string();
    }
    let mut hits = Vec::new();
    'files: for rel in walk_text_files(root) {
        let Ok(text) = read_text(root, &rel) else {
            continue;
        };
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                let shown: String = line.trim().chars().take(200).collect();
                hits.push(format!("{rel}:{}: {shown}", i + 1));
                if hits.len() >= MAX_SEARCH_MATCHES {
                    hits.push(format!("... (stopped at {MAX_SEARCH_MATCHES} matches)"));
                    break 'files;
                }
            }
        }
    }
    if hits.is_empty() {
        format!("No matches for \"{query}\" in the project folder.")
    } else {
        hits.join("\n")
    }
}

// ------------------------------------------------------------- style + library

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LibraryInclude {
    Always,
    Detected,
    Never,
}

#[derive(Serialize, Clone, Debug)]
pub struct LibraryEntry {
    pub name: String,
    pub aliases: Vec<String>,
    pub include: LibraryInclude,
    /// Path relative to the project root, for "open this entry".
    pub file: String,
    pub body: String,
}

fn parse_list(value: &str) -> Vec<String> {
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split([',', '，', '、'])
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn parse_library_entry(file: &str, stem: &str, content: &str) -> LibraryEntry {
    let mut entry = LibraryEntry {
        name: stem.to_string(),
        aliases: Vec::new(),
        include: LibraryInclude::Detected,
        file: file.to_string(),
        body: strip_html_comments(content).trim().to_string(),
    };
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                let value = value.trim();
                match key.trim() {
                    "name" if !value.is_empty() => {
                        entry.name = value.trim_matches('"').trim_matches('\'').to_string()
                    }
                    "aliases" => entry.aliases = parse_list(value),
                    "include" => {
                        entry.include = match value.trim_matches('"') {
                            "always" => LibraryInclude::Always,
                            "never" => LibraryInclude::Never,
                            _ => LibraryInclude::Detected,
                        }
                    }
                    _ => {}
                }
            }
            entry.body = strip_html_comments(&rest[end + 4..]).trim().to_string();
        }
    }
    entry
}

/// The library: `.textus/library/*.md`, plus a Levis project's
/// `.levis/library/*.md` that `.textus/` has no entry of the same name for.
pub fn read_library(root: &Path) -> Vec<LibraryEntry> {
    let mut by_stem: std::collections::BTreeMap<String, LibraryEntry> = Default::default();
    for project in project_read_dirs(root) {
        let folder = project
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Ok(entries) = std::fs::read_dir(project.join("library")) else {
            continue;
        };
        for path in entries.flatten().map(|e| e.path()) {
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let file = format!("{folder}/library/{stem}.md");
            // An entry with nothing written in it yet is still listed (the
            // Memory tab showed nothing after New library entry, as if it
            // had failed); relevant_library leaves it out of requests.
            by_stem.insert(stem.to_string(), parse_library_entry(&file, stem, &content));
        }
    }
    by_stem.into_values().collect()
}

/// Where "Learn my style" writes the profile: `.textus/style.md`.
fn style_path(root: &Path) -> PathBuf {
    project_dir(root).join("style.md")
}

/// The style profile: `.textus/style.md`, or a Levis project's
/// `.levis/style.md` while there is none.
pub fn read_style(root: &Path) -> Option<String> {
    project_file(root, "style.md")
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|s| strip_html_comments(&s).trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_STYLE_CHARS).collect())
}

/// The writing conventions a style profile's front matter sets: a
/// `conventions:` profile (or several, comma-separated, one per language)
/// and option keys such as `cjk-latin-space: on` - see rules::profile. The
/// front matter stays in the profile text the model reads.
pub fn style_conventions(style: Option<&str>) -> crate::ai::rules::ProjectConventions {
    style
        .map(crate::ai::rules::ProjectConventions::from_style)
        .unwrap_or_default()
}

/// The library entries a request should carry: `always` ones, plus
/// `detected` ones whose name or an alias appears in `context` (the user's
/// message, the selection, the text around the cursor). Bounded overall.
pub fn relevant_library<'a>(library: &'a [LibraryEntry], context: &str) -> Vec<&'a LibraryEntry> {
    let haystack = context.to_lowercase();
    let mut picked = Vec::new();
    let mut used = 0;
    for entry in library.iter().filter(|e| !e.body.is_empty()) {
        let hit = match entry.include {
            LibraryInclude::Always => true,
            LibraryInclude::Never => false,
            LibraryInclude::Detected => std::iter::once(&entry.name)
                .chain(entry.aliases.iter())
                .filter(|term| term.chars().count() >= 2)
                .any(|term| haystack.contains(&term.to_lowercase())),
        };
        if hit && used + entry.body.len() <= MAX_LIBRARY_CHARS {
            used += entry.body.len();
            picked.push(entry);
        }
    }
    picked
}

/// The prompt section for the style profile and the relevant library
/// entries - shared by the agent and the inline completion. Each header
/// says what the material is and how it binds: in the round-2 eval the
/// agent applied a profile's present tense to a plan for next year, split a
/// sentence under a length rule so it no longer covered what it had, and
/// shrank a requested expansion; and it recited a library entry's back
/// story as exposition where a scene was asked for.
pub fn writing_context_section(style: Option<&str>, entries: &[&LibraryEntry]) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(style) = style {
        parts.push(format!(
            "---the author's style profile (.textus/style.md: how this author writes, drafted from their own writing with \"Learn my style\" or written by them; follow it in all the text you write for this project's documents, whatever their language - it shapes that text, never the language you reply in. Its concrete limits - sentence length, words and punctuation to avoid - are rules; its habits apply where they read naturally and never override the request or the sense of the text: a habit of the present tense doesn't turn a plan into a fact, a habit of speaking to \"you\" doesn't turn the author's own account of what they did into the reader's, a length limit doesn't let a sentence drop what it covered, and an expansion still comes out longer)---\n{style}"
        ));
    }
    if !entries.is_empty() {
        let body = entries
            .iter()
            .map(|e| {
                let aka = if e.aliases.is_empty() {
                    String::new()
                } else {
                    format!(" (also: {})", e.aliases.join(", "))
                };
                format!("## {}{aka}\n{}", e.name, e.body)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        parts.push(format!(
            "---project library (.textus/library): established facts about the people, places and terms mentioned here - stay consistent with them, add nothing about them that neither this nor the text gives, and treat them as background: use them as constraints, not as text to recite---\n{body}"
        ));
    }
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn walking_skips_hidden_and_build_folders_and_reads_safely() {
        let dir = std::env::temp_dir().join(format!("textus-project-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, body) in [
            ("notes/a.md", "alpha beta"),
            ("b.txt", "Beta gamma"),
            (".secret/key.md", "beta"),
            ("node_modules/x.md", "beta"),
            ("image.png", "beta"),
        ] {
            let full = dir.join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, body).unwrap();
        }
        assert_eq!(walk_text_files(&dir), ["b.txt", "notes/a.md"]);
        let found = search(&dir, "beta");
        assert!(found.contains("b.txt:1:") && found.contains("notes/a.md:1:"));
        assert!(!found.contains(".secret") && !found.contains("node_modules"));
        assert!(read_text(&dir, ".secret/key.md").is_err());
        assert!(read_text(&dir, "../etc/passwd").is_err());
        assert_eq!(read_text(&dir, "@notes/a.md").unwrap(), "alpha beta");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_levis_projects_library_and_style_are_read_under_textus_ones() {
        let dir = std::env::temp_dir().join(format!("textus-legacy-lib-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, body) in [
            (".levis/library/lin.md", "---\nname: Lin\n---\nLevis Lin."),
            (".levis/library/wu.md", "---\nname: Wu\n---\nLevis Wu."),
            (".levis/style.md", "Short sentences."),
            (".textus/library/lin.md", "---\nname: Lin\n---\nTextus Lin."),
        ] {
            let full = dir.join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, body).unwrap();
        }
        std::fs::write(
            dir.join(".textus/library/new.md"),
            "---\nname: New\n---\n<!-- what to know about New -->\n",
        )
        .unwrap();
        let library = read_library(&dir);
        let bodies: Vec<_> = library.iter().map(|e| e.body.as_str()).collect();
        assert_eq!(bodies, ["Textus Lin.", "", "Levis Wu."]);
        // Listed, but never sent: nothing is written in it yet.
        assert!(relevant_library(&library, "New and Lin")
            .iter()
            .all(|e| e.name != "New"));
        let library: Vec<_> = library.into_iter().filter(|e| e.name != "New").collect();
        assert_eq!(library[1].file, ".levis/library/wu.md");
        assert_eq!(read_style(&dir).as_deref(), Some("Short sentences."));
        // "Learn my style" and "Open style profile" write .textus/style.md.
        assert_eq!(style_path(&dir), dir.join(".textus/style.md"));
        std::fs::write(dir.join(".textus/style.md"), "Long sentences.").unwrap();
        assert_eq!(read_style(&dir).as_deref(), Some("Long sentences."));
        assert_eq!(
            std::fs::read_to_string(dir.join(".levis/style.md")).unwrap(),
            "Short sentences."
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn filesystem_root_is_too_broad() {
        assert!(is_too_broad(Path::new("/")));
        assert!(!is_too_broad(
            &std::env::temp_dir().join("textus-some-project")
        ));
    }
}

// ------------------------------------------------------------------ commands

fn project_root(doc_path: Option<&str>, workspace_root: Option<&str>) -> Result<PathBuf, String> {
    crate::ai::workspace::project_root(doc_path, workspace_root)
        .ok_or_else(|| "NO_PROJECT".to_string())
}

/// The project's text files, for the composer's @-mention picker.
#[tauri::command]
pub async fn list_project_files(
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_root(doc_path.as_deref(), workspace_root.as_deref())
            .map(|root| walk_text_files(&root))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// One project file's text, for an @-mention - the same safety rules as the
/// agent's read_file tool.
#[tauri::command]
pub async fn read_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        read_text(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates `.textus/<rel>` with `template` unless it already exists, and
/// returns its absolute path - "new library entry", "open style profile".
/// A Levis project's `.levis/<rel>` is copied rather than opened in place.
#[tauri::command]
pub async fn ensure_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    rel: String,
    template: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        let rel = rel.trim_start_matches(['/', '\\']);
        if rel
            .split(['/', '\\'])
            .any(|part| part == ".." || part.is_empty())
        {
            return Err("Invalid file name.".to_string());
        }
        // A Levis project's .levis/<rel> is copied into .textus/ first, so
        // the author edits what they have and .levis/ stays as Levis left it.
        let path = writable_project_file(&root, rel).map_err(|e| e.to_string())?;
        if !path.exists() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            crate::atomic::write_sync(&path, template).map_err(|e| e.to_string())?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Multi-select picker for the writing samples "Learn my style" analyses.
#[tauri::command]
pub async fn pick_text_files(window: tauri::WebviewWindow) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window)
            .add_filter("Text", &["md", "markdown", "txt"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string())
            .collect()
    })
    .await
    .unwrap_or_default()
}

const STYLE_SAMPLE_CHARS: usize = 20_000;
const STYLE_TOTAL_CHARS: usize = 60_000;

/// The user turn of a "Learn my style" request: up to eight picked files,
/// each cut to STYLE_SAMPLE_CHARS, until STYLE_TOTAL_CHARS - shared with the
/// live eval, which feeds it the same files from a scratch folder.
pub(crate) fn style_samples(files: &[String]) -> Result<String, String> {
    let mut samples = String::new();
    for file in files.iter().take(8) {
        if samples.chars().count() >= STYLE_TOTAL_CHARS {
            break;
        }
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        let name = Path::new(file)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let excerpt: String = text.chars().take(STYLE_SAMPLE_CHARS).collect();
        samples.push_str(&format!(
            "<sample name=\"{name}\">\n{excerpt}\n</sample>\n\n"
        ));
    }
    if samples.trim().is_empty() {
        return Err("NO_SAMPLES".to_string());
    }
    Ok(samples)
}

/// "Learn my style": the prompt that drafts the style profile from samples.
/// The profile is written in the samples' language, headings included:
/// the author reviews and edits it in a tab right afterwards, and the
/// app's own templates (projectStyleTemplate in src/i18n/locales/) use
/// the same headings in each UI language. The round-2 eval found
/// Chinese samples profiled in English bullets - the earlier prompt fixed
/// English headings, gave only English examples and mentioned the language
/// once, mid-sentence - and bullets that didn't hold for the samples
/// ("about 6-8 paragraphs" for pieces of five and six, "no metaphors" next
/// to a metaphor). The headings come from ui_language.rs, one line for
/// each language that has its own (style-headings/<code>.txt).
pub(crate) fn style_instructions() -> String {
    let headings = crate::ai::ui_language::style_heading_lines();
    format!("You analyse an author's writing so that an AI writing assistant can continue and revise their text in their own voice. You are given samples the author picked as representative. Write their style profile in Markdown.

Write the whole profile in the language the samples are written in - headings, bullets and all: Chinese samples get a Chinese profile, Japanese samples a Japanese one, English samples an English one. The author reads and edits this file, and the assistant follows it. Use exactly these seven sections, in this order, with the headings in that language:

{headings}

Under each heading give 3-6 short, concrete, checkable bullet points drawn from the samples - \"opens paragraphs with a concrete scene, then the claim\", \"句子很短，多数不超过十五个字\", \"uses full-width Chinese punctuation, no em dashes\" - not generic praise or advice. Every bullet must hold for the samples as given: before writing one, check it against every sample - count instead of estimating, name a habit as \"every sample\" or \"always\" only if each sample shows it, and call something absent (metaphors, exclamation marks, a topic) only if no sample uses it. A habit of the samples' content - who they address, what they are about, their tense - is described as a habit, never as a rule for all writing (\"the pieces speak to the reader as 'you'\", not \"never uses I\"). The Never section lists only what no sample does and the author clearly avoids, and contradicts no other bullet. The Examples section quotes 2-3 short representative passages (1-3 sentences each) verbatim from the samples, without adding quotation marks around a passage that already contains them. Output only the profile, in the samples' language.")
}

/// "Learn my style": analyses the picked samples and writes the project's
/// `.textus/style.md` (keeping the previous one as style.previous.md), which
/// the agent and the inline completion then follow. Returns its path, which
/// the frontend opens for the author to review and edit.
#[tauri::command]
pub async fn learn_style(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    files: Vec<String>,
) -> Result<String, String> {
    let (root, samples) = {
        tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, String), String> {
            let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
            let samples = style_samples(&files)?;
            Ok((root, samples))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let profile = crate::ai::client::call(
        &app,
        &provider,
        style_instructions(),
        samples,
        model.as_deref(),
    )
    .await?;
    let profile = profile.trim();
    if profile.is_empty() {
        return Err("The model returned an empty profile.".to_string());
    }
    let path = style_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // The profile it replaces - .textus/style.md, or a Levis project's
    // .levis/style.md, which itself stays untouched.
    if let Some(previous) = project_file(&root, "style.md") {
        let _ = std::fs::copy(&previous, path.with_file_name("style.previous.md"));
    }
    crate::atomic::write(&path, format!("{profile}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
