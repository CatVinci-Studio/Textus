//! The project folder's files as Textus AI reads them: which are text,
//! the walk over them, and reading one whole or in parts (documents
//! through extract/, cached) or as an image.

use super::*;

/// Extensions read as text by listing, search and @-mentions.
pub(crate) const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "rst", "org", "tex", "csv", "tsv", "json", "yaml", "yml",
    "toml", "html", "htm", "xml",
];

/// What the sidebar lists first as a document (src/sidebar/file-search.ts);
/// find_files does the same.
pub(crate) const SIDEBAR_DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "text"];

/// Most an @-mention inlines: the whole file goes into the message.
pub(crate) const MAX_FILE_BYTES: u64 = 100 * 1024;

/// Largest text file read_file and search_files read: a whole book in one
/// file (a 300,000-word novel is about 2 MB, a long Chinese one about 6 MB),
/// well short of what a log or a data dump runs to. read_file shows it in
/// parts (MAX_READ_UNITS); search_files reads it a line at a time.
pub(crate) const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;

/// Most of a file one read_file call returns, in characters with Chinese,
/// Japanese and Korean ones counting 3 (`char_units`): about 40,000
/// characters of English or 13,000 of Chinese, roughly the same number of
/// tokens either way - a chapter, not a book.
pub(crate) const MAX_READ_UNITS: usize = 40_000;

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

pub(crate) fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

pub(crate) fn is_text_file(path: &Path) -> bool {
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
pub(crate) fn walk_files(root: &Path, keep: impl Fn(&Path) -> bool + Sync) -> ProjectFiles {
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
pub(crate) const WALK_TRUNCATED_NOTE: &str =
    "... (the project folder is too large to go through completely; some files were not looked at)";

/// `rel` inside `root`, checked: canonical containment (no `..`, absolute
/// paths or symlinks out) and no hidden components. Returns the path and
/// `rel` as the model should see it.
pub(crate) fn resolve(root: &Path, rel: &str) -> Result<(PathBuf, String), String> {
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

pub(crate) fn size_of(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |m| m.len())
}

pub(crate) fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// The whole text of `path`, or why it can't be read as text. A NUL byte
/// is a binary file with a text-looking extension.
pub(crate) fn whole_text(path: &Path, rel: &str) -> Result<String, String> {
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
pub(crate) struct Extracted {
    pub(crate) path: PathBuf,
    /// The file's size and modification time when it was extracted.
    pub(crate) stamp: (u64, Option<std::time::SystemTime>),
    pub(crate) text: Arc<String>,
}

/// How many extracted documents are kept, newest first, and how much text
/// in all - a folder of reports, not a library.
pub(crate) const MAX_CACHED_DOCUMENTS: usize = 16;

pub(crate) const MAX_CACHED_BYTES: usize = 32 * 1024 * 1024;

pub(crate) static EXTRACTED: Mutex<Vec<Extracted>> = Mutex::new(Vec::new());

/// The text of the document at `path` (FileKind::Document), extracted once
/// per version of the file.
pub(crate) fn document_text(path: &Path) -> Result<Arc<String>, String> {
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
pub(crate) fn line_units(line: &str) -> usize {
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
pub(crate) fn excerpt(rel: &str, text: &str, range: LineRange) -> String {
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
