//! Searching the project folder's files for words, and finding files by
//! name - each bounded in matches and time.

use super::*;

pub(crate) const MAX_SEARCH_MATCHES: usize = 40;

/// Most names find_files returns: past this the answer is a longer name.
pub(crate) const MAX_FOUND_FILES: usize = 50;

/// How long search_files reads files once they are listed. A folder of
/// writing is read in a fraction of this; a disk of code must not hold up
/// the request.
pub(crate) const SEARCH_TIME: Duration = Duration::from_secs(5);

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
pub(crate) struct Found {
    /// In file order, then line order; more than MAX_SEARCH_MATCHES when
    /// there are more.
    pub(crate) hits: Vec<String>,
    /// How many of the files, from the first, were read.
    pub(crate) read: usize,
}

/// The matching lines of `files`, read on every core. Files are taken in
/// order and the search stops once the files before the first unread one
/// hold more than MAX_SEARCH_MATCHES matches, so a folder always gives the
/// same matches however the threads ran - the AI's answers stay stable.
pub(crate) fn search_in_order(
    root: &Path,
    files: &[String],
    needle: &str,
    deadline: Instant,
) -> Found {
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
pub(crate) fn matching_lines(root: &Path, rel: &str, needle: &str) -> Vec<String> {
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
pub(crate) fn fold_name(text: &str) -> String {
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
