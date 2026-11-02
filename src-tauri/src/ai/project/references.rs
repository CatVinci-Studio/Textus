//! The project's reference library: the papers, books and notes in its
//! `references/` folder, searched by meaning-bearing words rather than one
//! exact phrase, and answered with the best passages (BM25), each pointing at
//! the lines read_file opens. Each file is extracted and indexed once per
//! version of it; the index lives in memory for this run of the app.

use super::*;
use std::collections::HashMap;

/// The folder, at the project's top, that holds the references.
pub(crate) const REFERENCES_DIR: &str = "references";

/// Passages returned per search.
const MAX_PASSAGES: usize = 8;
/// A passage is whole lines up to about this many characters.
const PASSAGE_CHARS: usize = 1_200;
/// What of a passage is shown; read_file has the rest.
const SHOWN_CHARS: usize = 700;
/// How long one search may spend extracting new or changed files; the rest
/// wait for the next search.
const INDEX_TIME: Duration = Duration::from_secs(8);
/// BM25's usual constants.
const K1: f64 = 1.2;
const B: f64 = 0.75;

/// Lines `first..=last` of a file, and the words in them.
struct Passage {
    first: usize,
    last: usize,
    text: String,
    terms: HashMap<String, u32>,
    len: u32,
}

struct IndexedFile {
    stamp: (u64, Option<std::time::SystemTime>),
    passages: Vec<Passage>,
}

/// Each project's indexed files, by path relative to its references folder.
type Index = HashMap<String, IndexedFile>;
static INDEXES: Mutex<Option<HashMap<PathBuf, Index>>> = Mutex::new(None);

/// The words of `text`, lowercased: runs of letters and digits, and in Chinese,
/// Japanese and Korean, which have no spaces, every two neighbouring characters.
pub(crate) fn terms(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut prev_cjk: Option<char> = None;
    for c in text.chars().flat_map(char::to_lowercase) {
        if is_cjk(c) {
            if word.chars().count() >= 2 {
                out.push(std::mem::take(&mut word));
            }
            word.clear();
            match prev_cjk {
                Some(p) => out.push(format!("{p}{c}")),
                None => out.push(c.to_string()),
            }
            prev_cjk = Some(c);
        } else if c.is_alphanumeric() {
            prev_cjk = None;
            word.push(c);
        } else {
            prev_cjk = None;
            if word.chars().count() >= 2 {
                out.push(std::mem::take(&mut word));
            }
            word.clear();
        }
    }
    if word.chars().count() >= 2 {
        out.push(word);
    }
    out
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

/// `text` cut into passages of whole lines, numbered from 1 as read_file
/// numbers them.
fn passages(text: &str) -> Vec<Passage> {
    let mut out = Vec::new();
    let mut lines: Vec<&str> = Vec::new();
    let mut first = 1;
    let mut size = 0;
    let mut flush = |lines: &mut Vec<&str>, first: usize, last: usize| {
        let text = lines.join("\n");
        lines.clear();
        let words = terms(&text);
        if words.is_empty() {
            return;
        }
        let mut counts = HashMap::new();
        for w in &words {
            *counts.entry(w.clone()).or_insert(0) += 1;
        }
        out.push(Passage {
            first,
            last,
            text,
            terms: counts,
            len: words.len() as u32,
        });
    };
    for (i, line) in text.lines().enumerate() {
        if lines.is_empty() {
            first = i + 1;
            size = 0;
        }
        lines.push(line);
        size += line.chars().count() + 1;
        if size >= PASSAGE_CHARS {
            flush(&mut lines, first, i + 1);
        }
    }
    if !lines.is_empty() {
        let last = first + lines.len() - 1;
        flush(&mut lines, first, last);
    }
    out
}

/// The text of one reference, extracted or read.
fn reference_text(path: &Path, rel: &str) -> Result<String, String> {
    match file_kind(path) {
        Some(FileKind::Document) => document_text(path).map(|t| t.as_str().to_string()),
        Some(FileKind::Text) if size_of(path) <= crate::extract::MAX_SOURCE_BYTES => {
            whole_text(path, rel)
        }
        _ => Err(format!("`{rel}` isn't readable.")),
    }
}

/// Brings `index` up to date with the folder: new and changed files indexed
/// until `deadline`, deleted ones dropped. Returns how many still wait.
fn refresh(index: &mut Index, dir: &Path, deadline: Instant) -> usize {
    let walked = walk_readable_files(dir, false);
    index.retain(|rel, _| walked.files.contains(rel));
    let mut waiting = 0;
    for rel in &walked.files {
        let path = dir.join(rel);
        let stamp = std::fs::metadata(&path)
            .map(|m| (m.len(), m.modified().ok()))
            .unwrap_or((0, None));
        if index.get(rel).is_some_and(|f| f.stamp == stamp) {
            continue;
        }
        if Instant::now() >= deadline {
            waiting += 1;
            continue;
        }
        let passages = reference_text(&path, rel)
            .map(|t| passages(&t))
            .unwrap_or_default();
        index.insert(rel.clone(), IndexedFile { stamp, passages });
    }
    waiting
}

/// Indexes all of `root`'s references now, however long it takes: after an
/// import, so the first search finds them ready.
pub(crate) fn warm_references(root: &Path) {
    let dir = root.join(REFERENCES_DIR);
    let mut indexes = INDEXES.lock().unwrap_or_else(|e| e.into_inner());
    let index = indexes
        .get_or_insert_with(HashMap::new)
        .entry(root.to_path_buf())
        .or_default();
    refresh(index, &dir, Instant::now() + Duration::from_secs(600));
}

/// The passages of `root`'s references that best answer `query`, best first,
/// as `references/<file>:<first>-<last>` and the passage.
pub fn search_references(root: &Path, query: &str) -> String {
    let dir = root.join(REFERENCES_DIR);
    if !dir.is_dir() {
        return format!("This project has no `{REFERENCES_DIR}/` folder, so there are no references to search. Papers, books and notes put in it are searched here.");
    }
    let wanted: Vec<String> = {
        let mut t = terms(query);
        t.sort();
        t.dedup();
        t
    };
    if wanted.is_empty() {
        return "Pass `query`: the words the passages should contain.".to_string();
    }
    let mut indexes = INDEXES.lock().unwrap_or_else(|e| e.into_inner());
    let index = indexes
        .get_or_insert_with(HashMap::new)
        .entry(root.to_path_buf())
        .or_default();
    let waiting = refresh(index, &dir, Instant::now() + INDEX_TIME);

    let all: Vec<(&String, &Passage)> = index
        .iter()
        .flat_map(|(rel, f)| f.passages.iter().map(move |p| (rel, p)))
        .collect();
    let n = all.len() as f64;
    let avg = all.iter().map(|(_, p)| p.len as f64).sum::<f64>() / n.max(1.0);
    let idf: Vec<f64> = wanted
        .iter()
        .map(|w| {
            let df = all.iter().filter(|(_, p)| p.terms.contains_key(w)).count() as f64;
            ((n - df + 0.5) / (df + 0.5) + 1.0).ln()
        })
        .collect();
    let mut scored: Vec<(f64, &String, &Passage)> = all
        .iter()
        .filter_map(|(rel, p)| {
            let score: f64 = wanted
                .iter()
                .zip(&idf)
                .filter_map(|(w, idf)| {
                    let tf = *p.terms.get(w)? as f64;
                    Some(idf * tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * p.len as f64 / avg)))
                })
                .sum();
            (score > 0.0).then_some((score, *rel, *p))
        })
        .collect();
    scored.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| a.1.cmp(b.1))
            .then_with(|| a.2.first.cmp(&b.2.first))
    });
    let mut out: Vec<String> = scored
        .iter()
        .take(MAX_PASSAGES)
        .map(|(_, rel, p)| {
            let mut shown: String = p.text.chars().take(SHOWN_CHARS).collect();
            if p.text.chars().count() > SHOWN_CHARS {
                shown.push('…');
            }
            format!("{REFERENCES_DIR}/{rel}:{}-{}\n{shown}", p.first, p.last)
        })
        .collect();
    if out.is_empty() {
        out.push(format!(
            "No passage in the {} indexed references matches \"{query}\" - try other words, or the words the sources themselves would use.",
            index.len()
        ));
    }
    if waiting > 0 {
        out.push(format!(
            "... ({waiting} files not indexed yet - search again for them)"
        ));
    }
    out.join("\n\n")
}
