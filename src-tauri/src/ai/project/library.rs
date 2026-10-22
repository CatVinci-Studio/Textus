//! The project's library and style profile as a request uses them: the
//! entries parsed, the ones the text in hand names picked, the section
//! they make, and which were sent last (the panel's Library shows them).

use super::*;

pub(crate) const MAX_STYLE_CHARS: usize = 6_000;

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
    /// Set on an entry Textus AI wrote with the remember tool (ai::memory),
    /// which the Memory tab also lists under "AI remembered".
    pub remembered: Option<Remembered>,
}

pub(crate) fn parse_list(value: &str) -> Vec<String> {
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
        remembered: Remembered::from_file(content),
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

/// The library: `.textus/library/*.md`, in file-name order.
pub fn read_library(root: &Path) -> Vec<LibraryEntry> {
    let Ok(entries) = std::fs::read_dir(project_dir(root).join("library")) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let stem = path.file_stem().and_then(|s| s.to_str())?;
            let content = std::fs::read_to_string(&path).ok()?;
            // An entry with nothing written in it yet is still listed (the
            // Memory tab showed nothing after New library entry, as if it
            // had failed); relevant_library leaves it out of requests.
            Some(parse_library_entry(
                &format!("{WORKSPACE_DIR_NAME}/library/{stem}.md"),
                stem,
                &content,
            ))
        })
        .collect()
}

/// Where "Learn my style" writes the profile: `.textus/style.md`.
pub(crate) fn style_path(root: &Path) -> PathBuf {
    project_dir(root).join("style.md")
}

/// The style profile: `.textus/style.md`.
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
/// message, the selection, the text around the cursor), until
/// MAX_LIBRARY_CHARS characters. Those that came up but didn't fit are
/// `left_out`, for the Memory tab to say so rather than drop them silently.
pub fn pick_library<'a>(library: &'a [LibraryEntry], context: &str) -> LibraryPick<'a> {
    let haystack = context.to_lowercase();
    let mut pick = LibraryPick::default();
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
        if !hit {
            continue;
        }
        let size = entry.body.chars().count();
        if used + size <= MAX_LIBRARY_CHARS {
            used += size;
            pick.included.push(entry);
        } else {
            pick.left_out.push(entry);
        }
    }
    pick
}

/// What pick_library chose for one request.
#[derive(Default)]
pub struct LibraryPick<'a> {
    pub included: Vec<&'a LibraryEntry>,
    /// Entries that came up but no longer fit.
    pub left_out: Vec<&'a LibraryEntry>,
}

/// The entries pick_library includes.
pub fn relevant_library<'a>(library: &'a [LibraryEntry], context: &str) -> Vec<&'a LibraryEntry> {
    pick_library(library, context).included
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

/// Which library entries reached Textus AI, for the Memory tab's marks
/// (`LibraryUse` in platform/ipc.ts): the entries' `file`s, those that came
/// up but didn't fit, and whether this is what the last conversation
/// request for the document carried (`lastRequest`) or what its text alone
/// would bring in, before any request.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUse {
    pub included: Vec<String>,
    pub left_out: Vec<String>,
    pub last_request: bool,
    /// MAX_LIBRARY_CHARS, for the tab to name.
    pub cap: usize,
}

impl LibraryUse {
    pub(crate) fn of(pick: &LibraryPick, last_request: bool) -> Self {
        let files = |entries: &[&LibraryEntry]| entries.iter().map(|e| e.file.clone()).collect();
        Self {
            included: files(&pick.included),
            left_out: files(&pick.left_out),
            last_request,
            cap: MAX_LIBRARY_CHARS,
        }
    }
}

/// The last request's LibraryUse per document path, recorded by
/// ai_agent_message - so the marks are what was sent, picked by the same
/// rule, never a second guess at it in TypeScript.
pub(crate) static LAST_SENT: std::sync::Mutex<std::collections::BTreeMap<String, LibraryUse>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

pub fn record_library_use(doc_path: Option<&str>, pick: &LibraryPick) {
    if let Ok(mut sent) = LAST_SENT.lock() {
        sent.insert(
            doc_path.unwrap_or_default().to_string(),
            LibraryUse::of(pick, true),
        );
    }
}
