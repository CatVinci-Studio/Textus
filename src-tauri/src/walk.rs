//! The one way Textus walks a folder, shared by the sidebar search and the AI's
//! project tools. Walks as fd does (the `ignore` crate), skipping hidden,
//! ignored and SKIPPED_DIRS entries without following symlinks, in a fixed order.

use ignore::{WalkBuilder, WalkState};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Directories that are never writing material: build output, dependency trees,
/// virtual environments, even without a `.gitignore` saying so.
pub(crate) const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    "venv",
    ".venv",
];

/// Where the walk stops; each limit marks it `truncated`. A folder of writing is
/// far below them all, and the time budget holds on a slow network drive.
pub(crate) struct Limits {
    /// Files kept (those `keep` accepts).
    pub files: usize,
    /// Everything looked at, folders and left-out files included: a tree
    /// of a million entries holding few files still ends.
    pub entries: usize,
    pub depth: usize,
    pub time: Duration,
}

pub(crate) const LIMITS: Limits = Limits {
    files: 50_000,
    entries: 500_000,
    depth: 24,
    time: Duration::from_secs(3),
};

/// One file the walk found.
#[derive(Debug, PartialEq)]
pub(crate) struct WalkedFile {
    pub path: PathBuf,
    /// From the walked folder, `/`-separated.
    pub rel: String,
}

#[derive(Debug)]
pub(crate) struct Walk {
    /// In the sidebar's tree order (`sort_key`).
    pub files: Vec<WalkedFile>,
    /// A limit was hit: there may be more files than `files` holds.
    pub truncated: bool,
}

/// The files under `root` that `keep` accepts (it sees each file's path).
pub(crate) fn walk(root: &Path, limits: &Limits, keep: impl Fn(&Path) -> bool + Sync) -> Walk {
    let deadline = Instant::now() + limits.time;
    let files = Mutex::new(Vec::new());
    let visited = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    WalkBuilder::new(root)
        .require_git(false)
        .follow_links(false)
        .max_depth(Some(limits.depth))
        .filter_entry(|entry| {
            !(entry.file_type().is_some_and(|t| t.is_dir())
                && SKIPPED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
        })
        .build_parallel()
        .run(|| {
            Box::new(|entry| {
                let Ok(entry) = entry else {
                    return WalkState::Continue;
                };
                let seen = visited.fetch_add(1, AtomicOrdering::Relaxed) + 1;
                if seen > limits.entries || Instant::now() > deadline {
                    truncated.store(true, AtomicOrdering::Relaxed);
                    return WalkState::Quit;
                }
                let path = entry.path();
                if !entry.file_type().is_some_and(|t| t.is_file()) || !keep(path) {
                    return WalkState::Continue;
                }
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let mut files = files.lock().unwrap();
                if files.len() >= limits.files {
                    truncated.store(true, AtomicOrdering::Relaxed);
                    return WalkState::Quit;
                }
                files.push(WalkedFile {
                    path: path.to_path_buf(),
                    rel,
                });
                WalkState::Continue
            })
        });
    let mut files: Vec<(Vec<u8>, WalkedFile)> = files
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|f| (sort_key(&f.rel), f))
        .collect();
    files.sort_unstable_by(|(x, a), (y, b)| x.cmp(y).then_with(|| a.rel.cmp(&b.rel)));
    Walk {
        files: files.into_iter().map(|(_, f)| f).collect(),
        truncated: truncated.into_inner(),
    }
}

/// `rel` as bytes that compare in the sidebar's tree order: folder by folder,
/// subfolders before files, names natural ("file2" before "file10") and caseless,
/// ties by code point. Precomputed per file, since in-place comparison was 3x slower.
fn sort_key(rel: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(rel.len() + 8);
    let mut parts = rel.split('/').peekable();
    while let Some(name) = parts.next() {
        // A folder (more follows) before a file.
        key.push(if parts.peek().is_some() { 0 } else { 1 });
        let mut rest = name;
        while let Some(c) = rest.chars().next() {
            if c.is_ascii_digit() {
                let end = rest
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(rest.len());
                let digits = rest[..end].trim_start_matches('0');
                // By value: a digit run sorts where its first digit would,
                // then the longer run (without leading zeros) is larger.
                key.push(b'0');
                key.push(digits.len().min(u8::MAX as usize) as u8);
                key.extend_from_slice(digits.as_bytes());
                rest = &rest[end..];
            } else {
                for lower in c.to_lowercase() {
                    let mut buf = [0; 4];
                    key.extend_from_slice(lower.encode_utf8(&mut buf).as_bytes());
                }
                rest = &rest[c.len_utf8()..];
            }
        }
        // Ends the name below any character: "ab" before "abc".
        key.push(0);
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;
    use std::fs;

    fn touch(root: &Path, rel: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn rels(walk: &Walk) -> Vec<&str> {
        walk.files.iter().map(|f| f.rel.as_str()).collect()
    }

    fn all(root: &Path, limits: &Limits) -> Walk {
        walk(root, limits, |_| true)
    }

    fn compare_paths(a: &str, b: &str) -> Ordering {
        sort_key(a).cmp(&sort_key(b)).then_with(|| a.cmp(b))
    }

    #[test]
    fn lists_folders_first_in_natural_order() {
        let dir = tempfile::tempdir().unwrap();
        for rel in [
            "b.md",
            "A.txt",
            "file10.md",
            "file2.md",
            "notes/章节一.markdown",
            "notes/deep/c.md",
            "photo.png",
        ] {
            touch(dir.path(), rel);
        }
        let walk = all(dir.path(), &LIMITS);
        assert_eq!(
            rels(&walk),
            [
                "notes/deep/c.md",
                "notes/章节一.markdown",
                "A.txt",
                "b.md",
                "file2.md",
                "file10.md",
                "photo.png"
            ]
        );
        assert!(!walk.truncated);
        assert_eq!(walk.files[0].path, dir.path().join("notes/deep/c.md"));
    }

    #[test]
    fn the_order_is_the_same_on_every_walk() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..300 {
            touch(dir.path(), &format!("{}/{}/{i}.md", i % 7, i % 3));
        }
        let first: Vec<String> = all(dir.path(), &LIMITS)
            .files
            .into_iter()
            .map(|f| f.rel)
            .collect();
        for _ in 0..5 {
            let again: Vec<String> = all(dir.path(), &LIMITS)
                .files
                .into_iter()
                .map(|f| f.rel)
                .collect();
            assert_eq!(again, first);
        }
    }

    #[test]
    fn names_compare_by_number_value_then_case() {
        assert_eq!(compare_paths("ch2", "ch10"), Ordering::Less);
        assert_eq!(compare_paths("ch02", "ch2"), Ordering::Less);
        assert_eq!(compare_paths("ch2a", "ch2"), Ordering::Greater);
        assert_eq!(compare_paths("第2章", "第10章"), Ordering::Less);
        assert_eq!(compare_paths("Apple", "banana"), Ordering::Less);
        assert_eq!(compare_paths("a", "A"), Ordering::Greater);
        assert_eq!(compare_paths("a b", "a1"), Ordering::Less);
        assert_eq!(compare_paths("a/z.md", "a.md"), Ordering::Less);
        assert_eq!(compare_paths("b/z.md", "a/z.md"), Ordering::Greater);
    }

    #[test]
    fn skips_hidden_entries_and_build_folders() {
        let dir = tempfile::tempdir().unwrap();
        for rel in [
            "keep.md",
            ".hidden.md",
            ".git/notes.md",
            "node_modules/pkg/readme.md",
            "target/out.md",
            "sub/node_modules/x.md",
        ] {
            touch(dir.path(), rel);
        }
        assert_eq!(rels(&all(dir.path(), &LIMITS)), ["keep.md"]);
    }

    #[test]
    fn leaves_out_what_gitignore_and_ignore_files_do_outside_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".gitignore"), "drafts/\n*.log\n").unwrap();
        for rel in [
            "keep.md",
            "drafts/old.md",
            "build.log",
            "notes/a.md",
            "notes/scratch.md",
        ] {
            touch(dir.path(), rel);
        }
        fs::write(dir.path().join("notes/.ignore"), "scratch.md\n").unwrap();
        assert_eq!(rels(&all(dir.path(), &LIMITS)), ["notes/a.md", "keep.md"]);
    }

    #[test]
    fn keeps_only_what_the_filter_accepts_and_counts_only_those() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            touch(dir.path(), &format!("{i}.png"));
        }
        touch(dir.path(), "a.md");
        let limits = Limits { files: 1, ..LIMITS };
        let walk = walk(dir.path(), &limits, |p| {
            p.extension().is_some_and(|e| e == "md")
        });
        assert_eq!(rels(&walk), ["a.md"]);
        assert!(!walk.truncated);
    }

    #[test]
    fn stops_at_the_file_limit_across_threads_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..200 {
            touch(dir.path(), &format!("{}/{i}.md", i % 8));
        }
        let limits = Limits {
            files: 10,
            ..LIMITS
        };
        let walk = all(dir.path(), &limits);
        assert_eq!(walk.files.len(), 10);
        assert!(walk.truncated);
    }

    #[test]
    fn stops_at_the_entries_limit_however_few_files_it_found() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            touch(dir.path(), &format!("{}/{i}.md", i % 5));
        }
        let limits = Limits {
            entries: 12,
            ..LIMITS
        };
        let walk = all(dir.path(), &limits);
        assert!(walk.files.len() < 12);
        assert!(walk.truncated);
    }

    #[test]
    fn stops_when_the_time_is_up() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a.md");
        let limits = Limits {
            time: Duration::ZERO,
            ..LIMITS
        };
        assert!(all(dir.path(), &limits).truncated);
    }

    #[test]
    fn does_not_descend_past_the_depth_limit() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "top.md");
        touch(dir.path(), "1/2/3/deep.md");
        let limits = Limits { depth: 2, ..LIMITS };
        assert_eq!(rels(&all(dir.path(), &limits)), ["top.md"]);
    }
}
