use super::ipc::Request;
use super::*;
use std::cell::RefCell;
use std::time::{Duration, Instant};

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// An app that isn't running, or one that answers every request the same way.
#[derive(Default)]
struct FakeApp {
    running: Option<(String, i32)>,
    sent: RefCell<Vec<(Request, bool)>>,
    opened: RefCell<Vec<Vec<String>>>,
}

impl App for FakeApp {
    fn send(&self, request: &Request, launch: bool, io: &mut Io) -> Option<Result<i32, String>> {
        self.sent.borrow_mut().push((request.clone(), launch));
        let (out, code) = self.running.clone()?;
        io.text(&out);
        Some(Ok(code))
    }

    fn open(&self, args: &[String]) -> Result<(), String> {
        self.opened.borrow_mut().push(args.to_vec());
        Ok(())
    }
}

/// Runs a command line; its exit code, stdout and stderr.
fn run_in(cwd: &Path, line: &[&str], app: &FakeApp) -> (i32, String, String) {
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut io = Io {
        out: &mut out,
        err: &mut err,
    };
    let code = run(&args(line), cwd, &mut io, app);
    (
        code,
        String::from_utf8(out).unwrap(),
        String::from_utf8(err).unwrap(),
    )
}

fn run_line(line: &[&str]) -> (i32, String, String) {
    run_in(Path::new("/"), line, &FakeApp::default())
}

#[test]
fn paths_and_nothing_open_the_app_and_words_are_commands() {
    let none = |_: &str| false;
    assert_eq!(classify(&[], none), Mode::Gui);
    assert_eq!(classify(&args(&["notes.md"]), none), Mode::Gui);
    assert_eq!(classify(&args(&["/a/b"]), none), Mode::Gui);
    assert_eq!(classify(&args(&["textus://command/x"]), none), Mode::Gui);
    assert_eq!(classify(&args(&["-psn_0_1"]), none), Mode::Gui);
    assert_eq!(classify(&args(&["search", "x"]), none), Mode::Cli);
    assert_eq!(classify(&args(&["--help"]), none), Mode::Cli);
    assert_eq!(classify(&args(&["-V"]), none), Mode::Cli);
    assert_eq!(classify(&args(&["serch"]), none), Mode::Cli);
    // A folder named like a word still opens.
    assert_eq!(classify(&args(&["Notes"]), |_| true), Mode::Gui);
    // A command wins over a file of its name.
    assert_eq!(classify(&args(&["list"]), |_| true), Mode::Cli);
}

#[test]
fn help_lists_every_command_but_the_ones_kept_for_later() {
    let (code, out, _) = run_line(&["help"]);
    assert_eq!(code, 0);
    for command in table::COMMANDS {
        let line = format!("\n  {:9} ", command.name);
        assert_eq!(
            out.contains(&line),
            command.runs != Runs::NotYet,
            "{} in help",
            command.name
        );
    }
    assert!(out.contains("Shown while Textus is running"));
    assert_eq!(run_line(&["--help"]).1, out);
}

#[test]
fn help_lists_the_running_apps_plugin_commands() {
    let app = FakeApp {
        running: Some(("  word-count count  Counts words.\n".into(), 0)),
        ..Default::default()
    };
    let (_, out, _) = run_in(Path::new("/"), &["help"], &app);
    assert!(out.contains("Plugin commands:\n  word-count count  Counts words.\n"));
    let sent = app.sent.borrow();
    assert_eq!(sent[0].0.command, tool_args::LIST_TOOLS);
    assert!(!sent[0].1, "help never starts the app");
}

#[test]
fn a_commands_help_is_its_usage() {
    let (code, out, _) = run_line(&["help", "search"]);
    assert_eq!(code, 0);
    assert!(out.starts_with("Usage: textus search <query> [<folder>]"));
    assert_eq!(run_line(&["search", "--help"]).1, out);
    assert_eq!(run_line(&["search", "-h"]).1, out);
}

#[test]
fn version_is_printed_three_ways() {
    let want = format!("Textus {}\n", env!("CARGO_PKG_VERSION"));
    for line in [&["version"][..], &["--version"], &["-V"]] {
        assert_eq!(run_line(line), (0, want.clone(), String::new()));
    }
}

#[test]
fn an_unknown_command_is_a_usage_error_on_stderr() {
    let (code, out, err) = run_line(&["serch", "x"]);
    assert_eq!(code, 2);
    assert!(out.is_empty());
    assert!(err.contains("'serch' is not a textus command"));
}

#[test]
fn a_plugin_word_goes_to_the_running_app_without_starting_it() {
    let app = FakeApp {
        running: Some(("12 words".into(), 0)),
        ..Default::default()
    };
    let (code, out, _) = run_in(
        Path::new("/w"),
        &["word-count", "count", "--text", "a b"],
        &app,
    );
    assert_eq!((code, out.as_str()), (0, "12 words\n"));
    let (request, launch) = app.sent.borrow()[0].clone();
    assert_eq!(request.command, "plugin:word-count");
    assert_eq!(request.args, args(&["count", "--text", "a b"]));
    assert!(!launch);
    // The help's own form: an object after --json is the tool's arguments.
    run_in(
        Path::new("/w"),
        &["word-count", "count", "--json", r#"{"text":"a"}"#],
        &app,
    );
    let (request, _) = app.sent.borrow()[1].clone();
    assert_eq!(request.args, args(&["count", "--json", r#"{"text":"a"}"#]));
}

#[test]
fn app_commands_start_the_app_and_carry_json_and_the_folder() {
    let app = FakeApp {
        running: Some(("[]".into(), 0)),
        ..Default::default()
    };
    let (code, _, _) = run_in(Path::new("/w"), &["theme", "list", "--json"], &app);
    assert_eq!(code, 0);
    let (request, launch) = app.sent.borrow()[0].clone();
    assert_eq!(
        request,
        Request {
            command: "theme".into(),
            args: args(&["list"]),
            cwd: "/w".into(),
            json: true,
        }
    );
    assert!(launch);
}

#[test]
fn open_hands_absolute_paths_to_the_app() {
    let app = FakeApp::default();
    let (code, _, _) = run_in(
        Path::new("/w/x"),
        &["open", "./a.md", "../b.md", "/c.md"],
        &app,
    );
    assert_eq!(code, 0);
    // Written with the platform's separators, as the resolved paths are.
    let at = |p: &str| {
        Path::new(p)
            .components()
            .collect::<std::path::PathBuf>()
            .to_string_lossy()
            .into_owned()
    };
    assert_eq!(
        app.opened.borrow()[0],
        vec![at("/w/x/a.md"), at("/w/b.md"), at("/c.md")]
    );
}

#[test]
fn ai_is_kept_for_later() {
    let (code, _, err) = run_line(&["ai", "hello"]);
    assert_eq!(code, 1);
    assert!(err.contains("not available yet"));
}

#[test]
fn files_are_created_moved_listed_searched_and_read() {
    let dir = tempfile::tempdir().unwrap();
    let app = FakeApp::default();
    let at = |line: &[&str]| run_in(dir.path(), line, &app);

    let (code, out, _) = at(&["new", "Plan", "--title", "The plan"]);
    assert_eq!(code, 0);
    assert!(out.trim_end().ends_with("Plan.md"));
    assert_eq!(at(&["new", "Plan.md"]).0, 1, "never replaces a file");

    std::fs::create_dir(dir.path().join("done")).unwrap();
    assert_eq!(at(&["move", "Plan.md", "done"]).0, 0);
    std::fs::write(dir.path().join("Plan.md"), "x").unwrap();
    assert_eq!(
        at(&["move", "Plan.md", "done"]).0,
        1,
        "never replaces a file"
    );

    assert_eq!(at(&["list"]).1, "done/Plan.md\nPlan.md\n");
    assert_eq!(
        at(&["list", "--json"]).1,
        "[\"done/Plan.md\",\"Plan.md\"]\n"
    );

    let (code, out, _) = at(&["search", "THE PLAN"]);
    assert_eq!((code, out.as_str()), (0, "done/Plan.md:1: # The plan\n"));
    assert_eq!(
        at(&["search", "plan", "--json"]).1,
        "[{\"line\":1,\"path\":\"done/Plan.md\",\"text\":\"# The plan\"}]\n"
    );
    assert_eq!(at(&["search", "nowhere"]).0, 1);
    // A built-in command's --json is the output form, whatever follows it.
    assert!(at(&["search", "--json", "{plan}"]).1.starts_with('['));

    assert_eq!(at(&["read", "done/Plan.md"]).1, "# The plan\n");
    std::fs::write(dir.path().join("page.html"), "<h1>Hi</h1><p>there</p>").unwrap();
    assert_eq!(at(&["read", "page.html"]).1, "# Hi\n\nthere\n");
}

#[test]
fn an_export_is_checked_before_the_app_is_asked() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "# A").unwrap();
    let request = |line: &[&str]| Request {
        command: "export".into(),
        args: args(line),
        cwd: dir.path().to_string_lossy().into_owned(),
        json: false,
    };
    let job = app::export_job(&request(&["./a.md", "--to", "latex"])).unwrap();
    assert_eq!(job.file, dir.path().join("a.md"));
    assert_eq!(job.out, dir.path().join("a.tex"));
    assert!(app::export_job(&request(&["a.md", "--to", "doc"])).is_err());
    assert!(app::export_job(&request(&["a.md"])).is_err());
    std::fs::write(dir.path().join("a.pdf"), "").unwrap();
    assert!(app::export_job(&request(&["a.md", "--to", "pdf"]))
        .unwrap_err()
        .contains("already there"));
}

/// Help and version answer without the app: a budget far above what they
/// take, but far below anything that started a runtime or a window.
#[test]
fn help_and_version_answer_in_milliseconds() {
    let started = Instant::now();
    for _ in 0..100 {
        run_line(&["help"]);
        run_line(&["version"]);
    }
    let each = started.elapsed() / 200;
    assert!(each < Duration::from_millis(5), "{each:?} a command");
}

#[test]
fn a_replies_text_reaches_the_terminal_once_with_one_line_break() {
    let mut out = Vec::new();
    let mut io = Io {
        out: &mut out,
        err: &mut std::io::sink(),
    };
    io.text("a\n");
    io.text("b");
    assert_eq!(out, b"a\nb\n");
}
