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

use crate::ai::memory::Remembered;
use crate::ai::workspace::{project_dir, project_file, strip_html_comments, WORKSPACE_DIR_NAME};
use base64::Engine;
use serde::Serialize;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

/// Extensions read as text by listing, search and @-mentions.
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "rst", "org", "tex", "csv", "tsv", "json", "yaml", "yml",
    "toml", "html", "htm", "xml",
];

/// What the sidebar lists first as a document (src/sidebar/file-search.ts);
/// find_files does the same.
const SIDEBAR_DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "text"];

/// Most an @-mention inlines: the whole file goes into the message.
const MAX_FILE_BYTES: u64 = 100 * 1024;
/// Largest text file read_file and search_files read: a whole book in one
/// file (a 300,000-word novel is about 2 MB, a long Chinese one about 6 MB),
/// well short of what a log or a data dump runs to. read_file shows it in
/// parts (MAX_READ_UNITS); search_files reads it a line at a time.
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
/// Most of a file one read_file call returns, in characters with Chinese,
/// Japanese and Korean ones counting 3 (`char_units`): about 40,000
/// characters of English or 13,000 of Chinese, roughly the same number of
/// tokens either way - a chapter, not a book.
const MAX_READ_UNITS: usize = 40_000;
const MAX_SEARCH_MATCHES: usize = 40;
/// Most names find_files returns: past this the answer is a longer name.
const MAX_FOUND_FILES: usize = 50;
/// How long search_files reads files once they are listed. A folder of
/// writing is read in a fraction of this; a disk of code must not hold up
/// the request.
const SEARCH_TIME: Duration = Duration::from_secs(5);
/// Most library text one request carries, in characters - not bytes, which
/// gave Chinese and Japanese a third of what English got.
pub(crate) const MAX_LIBRARY_CHARS: usize = 8_000;
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
    TEXT_EXTENSIONS.contains(&crate::extract::extension_of(path).as_str())
}

/// What the project tools make of a file, by its extension.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FileKind {
    Text,
    /// PDF, Word, PowerPoint, a spreadsheet, EPUB or RTF: read as the
    /// Markdown crate::extract makes of it. (An .html file is Text, checked
    /// first: here it is source to read as written.) Not what the sidebar calls a document
    /// (SIDEBAR_DOCUMENT_EXTENSIONS), which is a text file.
    Document,
    /// PNG, JPEG, GIF or WebP: shown to a model that can see (view_image).
    Image,
}

pub fn file_kind(path: &Path) -> Option<FileKind> {
    let ext = crate::extract::extension_of(path);
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        Some(FileKind::Text)
    } else if crate::extract::DOCUMENT_EXTENSIONS.contains(&ext.as_str()) {
        Some(FileKind::Document)
    } else if crate::extract::image_mime(&ext).is_some() {
        Some(FileKind::Image)
    } else {
        None
    }
}

/// Project files, as relative paths.
pub struct ProjectFiles {
    /// In the sidebar's tree order (crate::walk).
    pub files: Vec<String>,
    /// The walk hit a limit: there may be more.
    pub truncated: bool,
}

/// The project files `keep` accepts, walked as the sidebar's file search
/// walks (crate::walk): hidden entries, what `.gitignore`/`.ignore` leave
/// out and SKIPPED_DIRS are skipped, and a huge tree stops at the walk's
/// limits rather than stalling the request.
fn walk_files(root: &Path, keep: impl Fn(&Path) -> bool + Sync) -> ProjectFiles {
    let walk = crate::walk::walk(root, &crate::walk::LIMITS, keep);
    ProjectFiles {
        files: walk.files.into_iter().map(|f| f.rel).collect(),
        truncated: walk.truncated,
    }
}

/// Every text file under `root` - what an @-mention can attach.
pub fn walk_text_files(root: &Path) -> ProjectFiles {
    walk_files(root, is_text_file)
}

/// Every file the agent's tools can read: text files and documents, and
/// images when the model can see them (`images`).
pub fn walk_readable_files(root: &Path, images: bool) -> ProjectFiles {
    walk_files(root, |path| match file_kind(path) {
        Some(FileKind::Image) => images,
        kind => kind.is_some(),
    })
}

/// A file as list_files and find_files show it: images are marked, so the
/// model opens them with view_image rather than read_file.
pub fn listed(rel: &str) -> String {
    if file_kind(Path::new(rel)) == Some(FileKind::Image) {
        format!("{rel} (image)")
    } else {
        rel.to_string()
    }
}

/// Said after a listing that hit the walk's limits.
const WALK_TRUNCATED_NOTE: &str =
    "... (the project folder is too large to go through completely; some files were not looked at)";

/// `rel` inside `root`, checked: canonical containment (no `..`, absolute
/// paths or symlinks out) and no hidden components. Returns the path and
/// `rel` as the model should see it.
fn resolve(root: &Path, rel: &str) -> Result<(PathBuf, String), String> {
    let rel = rel.trim().trim_start_matches('@');
    if rel.is_empty() {
        return Err("No path provided.".to_string());
    }
    let (Ok(root_canon), Ok(path)) = (root.canonicalize(), root.join(rel).canonicalize()) else {
        return Err(format!(
            "`{rel}` doesn't exist. Use find_files or list_files to see what's there."
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
    if path.is_dir() {
        return Err(format!("`{rel}` is a folder, not a file."));
    }
    Ok((path, rel.to_string()))
}

fn size_of(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |m| m.len())
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// The whole text of `path`, or why it can't be read as text. A NUL byte
/// is a binary file with a text-looking extension.
fn whole_text(path: &Path, rel: &str) -> Result<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .filter(|text| !text.contains('\0'))
        .ok_or_else(|| format!("`{rel}` isn't a readable text file."))
}

/// Reads `rel` from inside `root` whole, for an @-mention: text only,
/// size-capped (resolve has the safety rules).
pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let (path, rel) = resolve(root, rel)?;
    let size = size_of(&path);
    if size > MAX_FILE_BYTES {
        return Err(format!(
            "`{rel}` is too large to read ({} KB; the limit is {} KB).",
            size / 1024,
            MAX_FILE_BYTES / 1024
        ));
    }
    whole_text(&path, &rel)
}

/// A document's extracted text, kept while the file is unchanged: reading
/// a long PDF in parts, or searching it again, would otherwise extract the
/// whole file on every call.
struct Extracted {
    path: PathBuf,
    /// The file's size and modification time when it was extracted.
    stamp: (u64, Option<std::time::SystemTime>),
    text: Arc<String>,
}

/// How many extracted documents are kept, newest first, and how much text
/// in all - a folder of reports, not a library.
const MAX_CACHED_DOCUMENTS: usize = 16;
const MAX_CACHED_BYTES: usize = 32 * 1024 * 1024;

static EXTRACTED: Mutex<Vec<Extracted>> = Mutex::new(Vec::new());

/// The text of the document at `path` (FileKind::Document), extracted once
/// per version of the file.
fn document_text(path: &Path) -> Result<Arc<String>, String> {
    let stamp = std::fs::metadata(path)
        .map(|m| (m.len(), m.modified().ok()))
        .map_err(|e| e.to_string())?;
    if stamp.0 > crate::extract::MAX_SOURCE_BYTES {
        return Err(format!(
            "It is too large to read ({}; the limit is {}).",
            megabytes(stamp.0),
            megabytes(crate::extract::MAX_SOURCE_BYTES)
        ));
    }
    let cached = |cache: &mut Vec<Extracted>| {
        let i = cache
            .iter()
            .position(|e| e.path == path && e.stamp == stamp)?;
        let entry = cache.remove(i);
        let text = entry.text.clone();
        cache.insert(0, entry);
        Some(text)
    };
    if let Some(text) = cached(&mut EXTRACTED.lock().unwrap()) {
        return Ok(text);
    }
    // Extracted outside the lock: a slow PDF holds up no other read.
    let ext = crate::extract::extension_of(path);
    let text = crate::extract::document_text(path, &ext)
        .unwrap_or_else(|| Err("It isn't a document Textus can read.".to_string()))?;
    if text.trim().is_empty() {
        return Err("It has no readable text.".to_string());
    }
    let text = Arc::new(text);
    let mut cache = EXTRACTED.lock().unwrap();
    cache.retain(|e| e.path != path);
    cache.insert(
        0,
        Extracted {
            path: path.to_path_buf(),
            stamp,
            text: text.clone(),
        },
    );
    let mut total = 0;
    let keep = cache
        .iter()
        .take(MAX_CACHED_DOCUMENTS)
        .take_while(|e| {
            total += e.text.len();
            total <= MAX_CACHED_BYTES
        })
        .count()
        .max(1);
    cache.truncate(keep);
    Ok(text)
}

/// A character's weight in MAX_READ_UNITS: Chinese, Japanese and Korean
/// characters are about a token each where English takes about four
/// letters to one, so they count 3.
pub(crate) fn char_units(c: char) -> usize {
    match c {
        '\u{1100}'..='\u{11ff}'
        | '\u{2e80}'..='\u{9fff}'
        | '\u{ac00}'..='\u{d7af}'
        | '\u{f900}'..='\u{faff}'
        | '\u{ff00}'..='\u{ffef}'
        | '\u{20000}'..='\u{3ffff}' => 3,
        _ => 1,
    }
}

/// A line's weight in MAX_READ_UNITS, its line break included.
fn line_units(line: &str) -> usize {
    line.chars().map(char_units).sum::<usize>() + 1
}

/// Which lines read_file shows: 1-based and inclusive, as search_files and
/// read_document number them. None reads from the start / to the end.
#[derive(Clone, Copy, Debug, Default)]
pub struct LineRange {
    pub start: Option<usize>,
    pub end: Option<usize>,
}

/// read_file: `rel`'s text, or the part of it `range` asks for, at most
/// MAX_READ_UNITS. A file that fits comes back as it is; otherwise the
/// answer says which lines of how many it holds and how to read on.
/// Documents are read as their extracted text, numbered the same way
/// search_files numbers them. Images are view_image's (`images`: whether
/// it is offered).
pub fn read_part(root: &Path, rel: &str, range: LineRange, images: bool) -> Result<String, String> {
    let (path, rel) = resolve(root, rel)?;
    let text = match file_kind(&path) {
        Some(FileKind::Image) if images => {
            return Err(format!(
                "`{rel}` is an image - use view_image to look at it."
            ))
        }
        Some(FileKind::Image) => {
            return Err(format!(
                "`{rel}` is an image, and the model in use can't see images - ask the user to describe it, or to switch to a provider that can."
            ))
        }
        Some(FileKind::Document) => {
            document_text(&path).map_err(|e| format!("`{rel}` can't be read: {e}"))?
        }
        _ => {
            let size = size_of(&path);
            if size > MAX_TEXT_BYTES {
                return Err(format!(
                    "`{rel}` is too large to read ({}; the limit is {}).",
                    megabytes(size),
                    megabytes(MAX_TEXT_BYTES)
                ));
            }
            Arc::new(whole_text(&path, &rel)?)
        }
    };
    Ok(excerpt(&rel, &text, range))
}

/// The lines of `text` that `range` asks for, cut to MAX_READ_UNITS.
fn excerpt(rel: &str, text: &str, range: LineRange) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    if total == 0 {
        return format!("`{rel}` is empty.");
    }
    let start = range.start.unwrap_or(1).clamp(1, total) - 1;
    let end = range.end.unwrap_or(total).clamp(start + 1, total);
    let mut out = String::new();
    let mut used = 0;
    let mut shown_end = start;
    let mut long_line = false;
    for line in &lines[start..end] {
        let units = line_units(line);
        if used + units > MAX_READ_UNITS {
            // One line longer than a whole read (a PDF without line breaks,
            // minified data): its beginning, rather than nothing at all.
            if out.is_empty() {
                let mut budget = MAX_READ_UNITS;
                for c in line.chars() {
                    let cost = char_units(c);
                    if cost > budget {
                        break;
                    }
                    budget -= cost;
                    out.push(c);
                }
                out.push('\n');
                shown_end += 1;
                long_line = true;
            }
            break;
        }
        out.push_str(line);
        out.push('\n');
        used += units;
        shown_end += 1;
    }
    let ranged = range.start.is_some() || range.end.is_some();
    if !ranged && shown_end == total && !long_line {
        return text.to_string();
    }
    let mut reply = format!(
        "`{rel}`, lines {}-{shown_end} of {total}:\n{out}",
        start + 1
    );
    if long_line {
        reply.push_str(&format!(
            "[... line {shown_end} is longer than one read can show; this is its beginning]"
        ));
    } else if shown_end < end {
        let next = shown_end + 1;
        reply.push_str(&if ranged {
            format!("[... cut for length - continue with start_line={next}]")
        } else {
            format!(
                "[... {} more lines not shown - read on with start_line={next}, or read the lines around a match search_files found]",
                total - shown_end
            )
        });
    }
    reply.trim_end().to_string()
}

/// view_image: the image at `rel`, for the model to look at, within the
/// size every provider accepts (crate::extract::MAX_IMAGE_BYTES). Textus
/// has no way to shrink an image, so a larger one is refused with why.
pub fn read_image(root: &Path, rel: &str) -> Result<aicompat::agent::ImageAttachment, String> {
    let (path, rel) = resolve(root, rel)?;
    let ext = crate::extract::extension_of(&path);
    let Some(mime) = crate::extract::image_mime(&ext) else {
        return Err(format!(
            "`{rel}` isn't an image Textus can show (PNG, JPEG, GIF or WebP) - read_file reads text and documents."
        ));
    };
    let size = size_of(&path);
    if size > crate::extract::MAX_IMAGE_BYTES {
        return Err(format!(
            "`{rel}` is too large to show ({}; the limit is {}), and Textus can't make images smaller - ask the user for a smaller copy.",
            megabytes(size),
            megabytes(crate::extract::MAX_IMAGE_BYTES)
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("`{rel}` can't be read: {e}"))?;
    Ok(aicompat::agent::ImageAttachment {
        name: rel,
        mime: mime.to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Case-insensitive line search across the project's text files and
/// documents, as `path:line: text`. Capped so a common word can't flood
/// the context.
pub fn search(root: &Path, query: &str) -> String {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return "No query provided.".to_string();
    }
    let walked = walk_readable_files(root, false);
    let found = search_in_order(root, &walked.files, &needle, Instant::now() + SEARCH_TIME);
    let mut hits = found.hits;
    if hits.len() > MAX_SEARCH_MATCHES {
        hits.truncate(MAX_SEARCH_MATCHES);
        hits.push(format!("... (stopped at {MAX_SEARCH_MATCHES} matches)"));
    } else if found.read < walked.files.len() {
        hits.push(format!(
            "... (stopped after {} of {} files - the search took too long; a more specific word, or find_files for a file by name, is faster)",
            found.read,
            walked.files.len()
        ));
    } else if walked.truncated {
        hits.push(WALK_TRUNCATED_NOTE.to_string());
    }
    if hits.is_empty() {
        format!("No matches for \"{query}\" in the project folder.")
    } else {
        hits.join("\n")
    }
}

/// What search_in_order found.
struct Found {
    /// In file order, then line order; more than MAX_SEARCH_MATCHES when
    /// there are more.
    hits: Vec<String>,
    /// How many of the files, from the first, were read.
    read: usize,
}

/// The matching lines of `files`, read on every core. Files are taken in
/// order and the search stops once the files before the first unread one
/// hold more than MAX_SEARCH_MATCHES matches, so a folder always gives the
/// same matches however the threads ran - the AI's answers stay stable.
fn search_in_order(root: &Path, files: &[String], needle: &str, deadline: Instant) -> Found {
    let slots: Vec<OnceLock<Vec<String>>> = files.iter().map(|_| OnceLock::new()).collect();
    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    // The files read in a row from the first, and the matches in them.
    let done = Mutex::new((0usize, 0usize));
    let workers = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(1, 8)
        .min(files.len());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                while !stop.load(Ordering::Relaxed) {
                    if Instant::now() >= deadline {
                        stop.store(true, Ordering::Relaxed);
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(rel) = files.get(i) else {
                        break;
                    };
                    let _ = slots[i].set(matching_lines(root, rel, needle));
                    let mut progress = done.lock().unwrap();
                    while let Some(hits) = slots.get(progress.0).and_then(OnceLock::get) {
                        progress.1 += hits.len();
                        progress.0 += 1;
                    }
                    if progress.1 > MAX_SEARCH_MATCHES {
                        stop.store(true, Ordering::Relaxed);
                    }
                }
            });
        }
    });
    let read = done.into_inner().unwrap().0;
    let mut hits = Vec::new();
    for slot in &slots[..read] {
        hits.extend(slot.get().into_iter().flatten().cloned());
        if hits.len() > MAX_SEARCH_MATCHES {
            break;
        }
    }
    Found { hits, read }
}

/// One file's lines containing `needle` (lowercase), at most one more than
/// the search returns, numbered as read_file numbers them. A text file is
/// read a line at a time, so a book costs no more memory than a chapter; one
/// read_file refuses - too large, not UTF-8 - has none, and so does a
/// document that can't be extracted.
fn matching_lines(root: &Path, rel: &str, needle: &str) -> Vec<String> {
    let path = root.join(rel);
    let mut hits = Vec::new();
    let mut add = |number: usize, line: &str| {
        if line.to_lowercase().contains(needle) {
            let shown: String = line.trim().chars().take(200).collect();
            hits.push(format!("{rel}:{number}: {shown}"));
        }
        hits.len() <= MAX_SEARCH_MATCHES
    };
    if file_kind(&path) == Some(FileKind::Document) {
        let Ok(text) = document_text(&path) else {
            return Vec::new();
        };
        for (i, line) in text.lines().enumerate() {
            if !add(i + 1, line) {
                break;
            }
        }
        return hits;
    }
    if size_of(&path) > MAX_TEXT_BYTES {
        return Vec::new();
    }
    let Ok(file) = std::fs::File::open(&path) else {
        return Vec::new();
    };
    let mut reader = std::io::BufReader::new(file);
    let mut line = String::new();
    let mut number = 0;
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            // Not UTF-8, or a NUL byte: a binary file, whatever its name.
            Ok(_) if line.contains('\0') => return Vec::new(),
            Ok(_) => {
                number += 1;
                let text = line.strip_suffix('\n').unwrap_or(&line);
                if !add(number, text.strip_suffix('\r').unwrap_or(text)) {
                    break;
                }
            }
            Err(_) => return Vec::new(),
        }
    }
    hits
}

/// A name as find_files compares it: one Unicode form (macOS hands names
/// over decomposed), no case, and `-`/`_` read as spaces, so "chapter 3"
/// finds chapter-3.md.
fn fold_name(text: &str) -> String {
    text.nfc()
        .flat_map(char::to_lowercase)
        .map(|c| if c == '-' || c == '_' { ' ' } else { c })
        .collect()
}

/// The project files whose path holds every word of `query`, ignoring case,
/// the way the sidebar's file search finds names; images among them when
/// the model can see (`images`). Documents come first, and within them
/// names that start with the query, then names that contain it, then paths
/// that only hold its words; each group in walk order. At most
/// MAX_FOUND_FILES.
pub fn find(root: &Path, query: &str, images: bool) -> String {
    let whole = fold_name(query.trim());
    let words: Vec<&str> = whole.split_whitespace().collect();
    if words.is_empty() {
        return "No name provided.".to_string();
    }
    let whole = words.join(" ");
    let walked = walk_readable_files(root, images);
    // [document: name starts, name contains, path holds; other: the same]
    let mut groups: [Vec<&str>; 6] = Default::default();
    for rel in &walked.files {
        let key = fold_name(rel);
        if !words.iter().all(|w| key.contains(w)) {
            continue;
        }
        let name = key.rsplit('/').next().unwrap_or(&key);
        let class = if name.starts_with(&whole) {
            0
        } else if name.contains(&whole) {
            1
        } else {
            2
        };
        let ext = crate::extract::extension_of(Path::new(rel));
        let other = !SIDEBAR_DOCUMENT_EXTENSIONS.contains(&ext.as_str());
        groups[usize::from(other) * 3 + class].push(rel);
    }
    let found = groups.concat();
    if found.is_empty() {
        let mut reply = format!(
            "No file in the project folder has \"{query}\" in its name or path. search_files looks inside files."
        );
        if walked.truncated {
            reply.push('\n');
            reply.push_str(WALK_TRUNCATED_NOTE);
        }
        return reply;
    }
    let mut lines: Vec<String> = found
        .iter()
        .take(MAX_FOUND_FILES)
        .map(|s| listed(s))
        .collect();
    if found.len() > MAX_FOUND_FILES {
        lines.push(format!(
            "... ({} more - give more of the name)",
            found.len() - MAX_FOUND_FILES
        ));
    } else if walked.truncated {
        lines.push(WALK_TRUNCATED_NOTE.to_string());
    }
    lines.join("\n")
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
    /// Set on an entry Textus AI wrote with the remember tool (ai::memory),
    /// which the Memory tab also lists under "AI remembered".
    pub remembered: Option<Remembered>,
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
fn style_path(root: &Path) -> PathBuf {
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
        assert!(
            read_part(dir.path(), "huge.md", LineRange::default(), false)
                .unwrap_err()
                .contains("too large to read (16.0 MB; the limit is 16.0 MB)")
        );
        assert!(
            read_part(dir.path(), "nul.txt", LineRange::default(), false)
                .unwrap_err()
                .contains("isn't a readable text file")
        );
    }

    /// A book in one file: past MAX_FILE_BYTES, which an @-mention still
    /// keeps to, read_file shows it in parts and search_files points into
    /// it by line, the way read_file numbers lines.
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

        let first = read_part(root, "book.md", LineRange::default(), false).unwrap();
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
            false,
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
            false,
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
        let out = read_part(dir.path(), "书.md", LineRange::default(), false).unwrap();
        let cjk = out.chars().filter(|&c| char_units(c) == 3).count();
        assert!((12_000..=MAX_READ_UNITS / 3).contains(&cjk), "{cjk}");
        assert!(out.contains("more lines not shown"));
    }

    #[test]
    fn a_line_longer_than_a_read_shows_its_beginning() {
        let dir = project(&[("one-line.txt", &"word ".repeat(20_000))]);
        let out = read_part(dir.path(), "one-line.txt", LineRange::default(), false).unwrap();
        assert!(out.starts_with("`one-line.txt`, lines 1-1 of 1:\nword word"));
        assert!(
            out.ends_with("[... line 1 is longer than one read can show; this is its beginning]")
        );
        assert!(out.len() < MAX_READ_UNITS + 200);
    }

    #[test]
    fn a_small_file_reads_whole_and_a_range_says_where_it_is() {
        let dir = project(&[("a.md", "one\ntwo\nthree\n"), ("empty.md", "")]);
        let whole = read_part(dir.path(), "@a.md", LineRange::default(), false).unwrap();
        assert_eq!(whole, "one\ntwo\nthree\n");
        let range = LineRange {
            start: Some(2),
            end: Some(9),
        };
        assert_eq!(
            read_part(dir.path(), "a.md", range, false).unwrap(),
            "`a.md`, lines 2-3 of 3:\ntwo\nthree"
        );
        assert_eq!(
            read_part(dir.path(), "empty.md", range, false).unwrap(),
            "`empty.md` is empty."
        );
        assert!(read_part(dir.path(), ".", range, false)
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
            read_part(root, "research/interview.docx", LineRange::default(), false).unwrap(),
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
                false
            )
            .unwrap(),
            "`research/interview.docx`, lines 3-3 of 3:\nShe takes the 6:40 bus."
        );
        assert_eq!(
            search(root, "6:40"),
            "research/interview.docx:3: She takes the 6:40 bus."
        );
        assert_eq!(
            read_part(root, "broken.pdf", LineRange::default(), false).unwrap_err(),
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
        assert_eq!(
            read_part(root, "map.png", LineRange::default(), true).unwrap_err(),
            "`map.png` is an image - use view_image to look at it."
        );
        assert!(read_part(root, "map.png", LineRange::default(), false)
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
            (".levis/library/wu.md", "---\nname: Wu\n---\nLevis Wu."),
            (".levis/style.md", "Short sentences."),
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
    /// `TEXTUS_PROJECT_BENCH=<dir> cargo test --release
    /// project_tools_benchmark -- --ignored --nocapture`, with
    /// `TEXTUS_PROJECT_BENCH_WORDS=<rare>,<common>,<name>` for that folder.
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
            .map(|root| walk_text_files(&root).files)
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
    fn of(pick: &LibraryPick, last_request: bool) -> Self {
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
static LAST_SENT: std::sync::Mutex<std::collections::BTreeMap<String, LibraryUse>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

pub fn record_library_use(doc_path: Option<&str>, pick: &LibraryPick) {
    if let Ok(mut sent) = LAST_SENT.lock() {
        sent.insert(
            doc_path.unwrap_or_default().to_string(),
            LibraryUse::of(pick, true),
        );
    }
}

/// The Memory tab's "used" marks: what the last request for the document
/// carried, or before one, what the document's text brings in by itself.
#[tauri::command]
pub async fn library_use(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    document: String,
) -> LibraryUse {
    if let Some(sent) = LAST_SENT
        .lock()
        .ok()
        .and_then(|sent| sent.get(doc_path.as_deref().unwrap_or_default()).cloned())
    {
        return sent;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(root) = project_root(doc_path.as_deref(), workspace_root.as_deref()) else {
            return LibraryUse::default();
        };
        let library = read_library(&root);
        let context = crate::ai::agent::document_section(&document, true, None);
        LibraryUse::of(&pick_library(&library, &context), false)
    })
    .await
    .unwrap_or_default()
}

/// Creates `.textus/<rel>` with `template` unless it already exists, and
/// returns its absolute path - "new library entry", "open style profile".
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
        let path = project_dir(&root).join(rel);
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
    crate::ai::ensure_on(&app)?;
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
    if let Some(previous) = project_file(&root, "style.md") {
        let _ = std::fs::copy(&previous, path.with_file_name("style.previous.md"));
    }
    crate::atomic::write(&path, format!("{profile}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
