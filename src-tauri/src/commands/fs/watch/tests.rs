use super::*;
use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind, RenameMode};
use std::sync::mpsc as std_mpsc;

fn event(kind: EventKind, paths: &[&str]) -> notify::Result<Event> {
    let mut event = Event::new(kind);
    for path in paths {
        event = event.add_path(PathBuf::from(path));
    }
    Ok(event)
}

fn known() -> HashMap<PathBuf, String> {
    HashMap::from([
        (PathBuf::from("/real/notes"), "/link/notes".to_string()),
        (
            PathBuf::from("/real/notes/drafts"),
            "/link/notes/drafts".to_string(),
        ),
    ])
}

#[test]
fn a_change_names_the_open_folder_it_is_in_as_the_tree_knows_it() {
    let none = |_: &Path| false;
    let made = event(EventKind::Create(CreateKind::File), &["/real/notes/a.md"]);
    assert_eq!(
        touched(&made, &known(), none),
        Some(vec!["/link/notes".to_string()])
    );
    // A watched folder removed: it and the folder it was in.
    let gone = event(
        EventKind::Remove(RemoveKind::Folder),
        &["/real/notes/drafts"],
    );
    assert_eq!(
        touched(&gone, &known(), none),
        Some(vec![
            "/link/notes".to_string(),
            "/link/notes/drafts".to_string()
        ])
    );
}

#[test]
fn reads_own_writes_and_unwatched_folders_change_nothing() {
    let none = |_: &Path| false;
    let empty = Some(Vec::new());
    let read = event(EventKind::Access(AccessKind::Any), &["/real/notes/a.md"]);
    assert_eq!(touched(&read, &known(), none), empty);
    let temp = event(
        EventKind::Create(CreateKind::File),
        &["/real/notes/.a.md.1-0.tmp"],
    );
    assert_eq!(touched(&temp, &known(), none), empty);
    let below = event(
        EventKind::Create(CreateKind::File),
        &["/real/notes/.git/index"],
    );
    assert_eq!(touched(&below, &known(), none), empty);
    let saved = event(EventKind::Modify(ModifyKind::Any), &["/real/notes/a.md"]);
    assert_eq!(
        touched(&saved, &known(), |p: &Path| p.ends_with("a.md")),
        empty
    );
}

#[test]
fn a_lost_track_reads_every_folder_again() {
    let none = |_: &Path| false;
    let lost: notify::Result<Event> = Err(notify::Error::generic("overflow"));
    assert_eq!(touched(&lost, &known(), none), None);
    let rescan = Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan));
    assert_eq!(touched(&rescan, &known(), none), None);
}

/// Runs `coalesce` over the known folders; what it sends comes back on the
/// receiver.
fn gather() -> (
    mpsc::UnboundedSender<notify::Result<Event>>,
    std_mpsc::Receiver<DirsChanged>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let (out, sent) = std_mpsc::channel();
    let known: Known = Arc::new(Mutex::new(known()));
    tokio::spawn(coalesce(
        rx,
        known,
        |_: &Path| false,
        move |c| {
            let _ = out.send(c);
        },
    ));
    (tx, sent)
}

fn made(path: &str) -> notify::Result<Event> {
    event(EventKind::Create(CreateKind::File), &[path])
}

#[tokio::test(start_paused = true)]
async fn a_burst_of_changes_is_sent_once_after_a_quiet_150_ms() {
    let (tx, sent) = gather();
    for name in ["a", "b", "c"] {
        tx.send(made(&format!("/real/notes/{name}.md"))).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tx.send(made("/real/notes/drafts/d.md")).unwrap();
    tokio::time::sleep(Duration::from_millis(140)).await;
    assert!(sent.try_recv().is_err(), "sent before it went quiet");
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        sent.try_recv().unwrap(),
        DirsChanged {
            dirs: vec!["/link/notes".into(), "/link/notes/drafts".into()],
            all: false
        }
    );
    assert!(sent.try_recv().is_err());
    // Nothing gathered (a read), nothing sent.
    tx.send(event(
        EventKind::Access(AccessKind::Any),
        &["/real/notes/a.md"],
    ))
    .unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(sent.try_recv().is_err());
}

#[tokio::test(start_paused = true)]
async fn changes_that_never_go_quiet_are_still_sent_each_second() {
    let (tx, sent) = gather();
    for _ in 0..25 {
        tx.send(made("/real/notes/a.md")).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // 2.5 s of changes every 100 ms: sent at 1 s and 2 s.
    assert_eq!(sent.try_iter().count(), 2);
}

/// The system's own watcher, in a real folder: a file made, renamed and
/// removed outside the app each reach the tree, by the path it gave.
#[tokio::test]
async fn a_real_folder_reports_files_made_renamed_and_removed() {
    let dir = tempfile::tempdir().unwrap();
    let given = dir.path().to_string_lossy().to_string();
    let (out, sent) = std_mpsc::channel();
    let mut watch = watcher(move |c| {
        let _ = out.send(c);
    })
    .unwrap();
    assert!(watch_only(&mut watch, vec![given.clone()], false));
    let expect = DirsChanged {
        dirs: vec![given.clone()],
        all: false,
    };
    let next = || sent.recv_timeout(Duration::from_secs(10)).unwrap();
    // FSEvents may report what happened just before the watch began.
    tokio::time::sleep(Duration::from_millis(300)).await;
    while sent.try_recv().is_ok() {}

    std::fs::write(dir.path().join("a.md"), "# A").unwrap();
    assert_eq!(next(), expect);
    std::fs::rename(dir.path().join("a.md"), dir.path().join("b.md")).unwrap();
    assert_eq!(next(), expect);
    std::fs::remove_file(dir.path().join("b.md")).unwrap();
    assert_eq!(next(), expect);

    // A new file the app wrote is news, to other windows' trees too; the
    // same file saved again is not.
    let own = dir.path().join("own.md");
    crate::atomic::write_sync(&own, "# Own").unwrap();
    assert_eq!(next(), expect);
    tokio::time::sleep(Duration::from_millis(300)).await;
    while sent.try_recv().is_ok() {}
    crate::atomic::write_sync(&own, "# Own, again").unwrap();
    assert!(sent.recv_timeout(Duration::from_secs(1)).is_err());
    // Taken away by another app just after: news, however new the write.
    std::fs::remove_file(&own).unwrap();
    assert_eq!(next(), expect);

    // The tree reading the folder is not a change: no loop.
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        entry.unwrap().metadata().unwrap();
    }
    assert!(sent.recv_timeout(Duration::from_secs(1)).is_err());
}

#[test]
fn only_what_makes_or_writes_a_file_can_be_the_apps_own() {
    let own = |_: &Path| true;
    let gone = event(EventKind::Remove(RemoveKind::File), &["/real/notes/a.md"]);
    assert_eq!(
        touched(&gone, &known(), own),
        Some(vec!["/link/notes".into()])
    );
    let from = event(
        EventKind::Modify(ModifyKind::Name(RenameMode::From)),
        &["/real/notes/a.md"],
    );
    assert_eq!(
        touched(&from, &known(), own),
        Some(vec!["/link/notes".into()])
    );
    // macOS's rename names no side: one no longer there was renamed away.
    let away = event(
        EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
        &["/real/notes/no-such-file.md"],
    );
    assert_eq!(
        touched(&away, &known(), own),
        Some(vec!["/link/notes".into()])
    );
    let both = event(
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        &["/real/notes/a.md", "/real/notes/drafts/a.md"],
    );
    assert_eq!(
        touched(&both, &known(), own),
        Some(vec!["/link/notes".into()])
    );
    let written = event(EventKind::Create(CreateKind::File), &["/real/notes/a.md"]);
    assert_eq!(touched(&written, &known(), own), Some(Vec::new()));
}

#[test]
fn watched_whole_only_the_topmost_open_folders_are_watched() {
    let dirs = [
        PathBuf::from("/n"),
        PathBuf::from("/n/a"),
        PathBuf::from("/n/a/b"),
        PathBuf::from("/other"),
        PathBuf::from("/nb"),
    ];
    let whole = watch_plan(dirs.iter(), true);
    let mut roots: Vec<_> = whole.keys().cloned().collect();
    roots.sort();
    assert_eq!(roots, [PathBuf::from("/n"), "/nb".into(), "/other".into()]);
    assert!(whole.values().all(|m| *m == RecursiveMode::Recursive));
    let alone = watch_plan(dirs.iter(), false);
    assert_eq!(alone.len(), dirs.len());
    assert!(alone.values().all(|m| *m == RecursiveMode::NonRecursive));
}

#[test]
fn an_older_call_than_the_last_is_passed_over() {
    let mut asked = HashMap::new();
    assert!(newest(&mut asked, "main", 2.0));
    assert!(!newest(&mut asked, "main", 1.0));
    assert!(!newest(&mut asked, "main", 2.0));
    assert!(newest(&mut asked, "window-2", 1.0));
    assert!(newest(&mut asked, "main", 3.0));
}

/// A folder watched whole: what changes in an open folder below reaches
/// the tree by that folder; a folded one is never named.
#[tokio::test]
async fn a_folder_watched_whole_reports_its_open_folders_alone() {
    let dir = tempfile::tempdir().unwrap();
    let open = dir.path().join("open");
    let folded = dir.path().join("folded");
    std::fs::create_dir_all(&open).unwrap();
    std::fs::create_dir_all(&folded).unwrap();
    let given = dir.path().to_string_lossy().to_string();
    let open_given = open.to_string_lossy().to_string();
    let (out, sent) = std_mpsc::channel();
    let mut watch = watcher(move |c| {
        let _ = out.send(c);
    })
    .unwrap();
    assert!(watch_only(
        &mut watch,
        vec![given, open_given.clone()],
        true
    ));
    tokio::time::sleep(Duration::from_millis(300)).await;
    while sent.try_recv().is_ok() {}
    std::fs::write(folded.join("x.md"), "# X").unwrap();
    std::fs::write(open.join("a.md"), "# A").unwrap();
    let mut dirs = BTreeSet::new();
    while !dirs.contains(&open_given) {
        dirs.extend(sent.recv_timeout(Duration::from_secs(10)).unwrap().dirs);
    }
    assert!(!dirs.iter().any(|d| d.ends_with("folded")), "{dirs:?}");
}
