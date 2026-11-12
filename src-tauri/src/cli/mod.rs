//! The `textus` terminal command. `main` asks `entry` first: a command runs
//! here and the process exits before Tauri, a webview or a plugin starts;
//! paths and a bare `textus` go on to the app as they always did.

pub mod app;
mod handoff;
pub mod ipc;
mod local;
mod table;
#[cfg(test)]
mod tests;
pub mod tool_args;

use ipc::{Reply, Request};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use table::Runs;

pub use handoff::SCRIPT_ENV;

/// What the arguments ask for.
#[derive(Debug, PartialEq)]
pub enum Mode {
    /// Files, folders, links or nothing: the app window.
    Gui,
    /// A command (or a word that may be a plugin's).
    Cli,
}

/// A command when the first argument is one of the table's, a help or
/// version flag, or a bare word that names no file here; anything else is
/// what a file manager or the old script passed, and opens in the app.
pub fn classify(args: &[String], exists: impl Fn(&str) -> bool) -> Mode {
    let Some(first) = args.first() else {
        return Mode::Gui;
    };
    let flag = matches!(first.as_str(), "-h" | "--help" | "-V" | "--version");
    let word = !first.is_empty()
        && !first.starts_with('-')
        && !first.contains(['/', '\\', '.', ':'])
        && !exists(first);
    if flag || table::find(first).is_some() || word {
        Mode::Cli
    } else {
        Mode::Gui
    }
}

/// `arg` against `cwd` with `.` and `..` folded, so `./a.md` names the
/// same file, and the same open tab, as its full path.
pub(crate) fn resolve(cwd: &Path, arg: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for part in cwd.join(arg).components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// Runs the command line if it is a command; its exit code. None: start
/// the app as usual.
pub fn entry() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let from_script = std::env::var_os(SCRIPT_ENV).is_some();
    match classify(&args, |a| cwd.join(a).exists()) {
        Mode::Gui if !from_script => None,
        Mode::Gui => Some(report(handoff::launch(&handoff::absolute(&args, &cwd)))),
        Mode::Cli => {
            handoff::attach_console();
            let (mut out, mut err) = (std::io::stdout().lock(), std::io::stderr().lock());
            let mut io = Io {
                out: &mut out,
                err: &mut err,
            };
            let code = run(&args, &cwd, &mut io, &RunningApp);
            let _ = io.out.flush();
            Some(code)
        }
    }
}

fn report(result: Result<(), String>) -> i32 {
    match result {
        Ok(()) => 0,
        Err(why) => {
            eprintln!("textus: {why}");
            1
        }
    }
}

/// Where a command's output goes.
pub struct Io<'a> {
    pub out: &'a mut dyn Write,
    pub err: &'a mut dyn Write,
}

impl Io<'_> {
    pub fn line(&mut self, text: &str) {
        let _ = writeln!(self.out, "{text}");
    }

    /// `text` with one line break at its end.
    pub fn text(&mut self, text: &str) {
        let _ = write!(self.out, "{text}");
        if !text.ends_with('\n') {
            let _ = writeln!(self.out);
        }
    }

    pub fn warn(&mut self, text: &str) {
        let _ = writeln!(self.err, "textus: {text}");
    }
}

pub struct Ctx {
    pub cwd: PathBuf,
    pub json: bool,
}

/// The running app, as a command reaches it.
pub trait App {
    /// Sends a request, starting the app first when `launch`; None when it
    /// isn't running and wasn't to be started.
    fn send(&self, request: &Request, launch: bool, io: &mut Io) -> Option<Result<i32, String>>;
    /// Opens paths in it (or brings it to the front).
    fn open(&self, args: &[String]) -> Result<(), String>;
}

struct RunningApp;

impl App for RunningApp {
    fn send(&self, request: &Request, launch: bool, io: &mut Io) -> Option<Result<i32, String>> {
        let stream = if launch {
            match handoff::connect_or_launch() {
                Ok(stream) => Box::new(stream) as Box<dyn ReadWrite>,
                Err(why) => return Some(Err(why)),
            }
        } else {
            Box::new(ipc::connect()?)
        };
        Some(ipc::exchange(stream, request, |reply| match reply {
            Reply::Out(text) => io.text(&text),
            Reply::Err(text) => {
                let _ = write!(io.err, "{text}");
                if !text.ends_with('\n') {
                    let _ = writeln!(io.err);
                }
            }
            Reply::Exit(_) => {}
        }))
    }

    fn open(&self, args: &[String]) -> Result<(), String> {
        handoff::launch(args)
    }
}

trait ReadWrite: std::io::Read + Write {}
impl<T: std::io::Read + Write> ReadWrite for T {}

/// Takes `--name value` or `--name=value` out of `args`.
pub fn take_option(args: &mut Vec<String>, name: &str) -> Result<Option<String>, String> {
    let prefix = format!("{name}=");
    let Some(at) = args
        .iter()
        .position(|a| a == name || a.starts_with(&prefix))
    else {
        return Ok(None);
    };
    let arg = args.remove(at);
    if let Some(value) = arg.strip_prefix(&prefix) {
        return Ok(Some(value.to_string()));
    }
    if at < args.len() {
        Ok(Some(args.remove(at)))
    } else {
        Err(format!("{name} needs a value."))
    }
}

fn take_flag(args: &mut Vec<String>, names: &[&str]) -> bool {
    let before = args.len();
    args.retain(|a| !names.contains(&a.as_str()));
    args.len() != before
}

/// Runs one command line (without the program name); the exit code.
pub fn run(args: &[String], cwd: &Path, io: &mut Io, app: &dyn App) -> i32 {
    let Some((first, rest)) = args.split_first() else {
        return 0;
    };
    let mut rest = rest.to_vec();
    match first.as_str() {
        "-h" | "--help" => return help(rest.first(), io, app),
        "-V" | "--version" => return version(io),
        _ => {}
    }
    let help_asked = take_flag(&mut rest, &["-h", "--help"]);
    let ctx = Ctx {
        cwd: cwd.to_path_buf(),
        json: take_flag(&mut rest, &["--json"]),
    };
    let Some(command) = table::find(first) else {
        return plugin_command(first, rest, &ctx, help_asked, io, app);
    };
    if help_asked {
        io.text(&table::usage(command));
        return 0;
    }
    let result = match (command.runs, command.name) {
        (_, "help") => return help(rest.first(), io, app),
        (_, "version") => return version(io),
        (Runs::NotYet, name) => Err(format!("'textus {name}' is not available yet.")),
        (Runs::Open, _) => app.open(&handoff::absolute(&rest, cwd)).map(|()| 0),
        (Runs::App, name) => to_app(name, rest, &ctx, true, io, app),
        (Runs::Here, "list") => local::list(&ctx, &rest, io),
        (Runs::Here, "read") => local::read(&ctx, &rest, io),
        (Runs::Here, "search") => local::search(&ctx, &rest, io),
        (Runs::Here, "new") => local::new(&ctx, &rest, io),
        (Runs::Here, "move") => local::move_entry(&ctx, &rest, io),
        (Runs::Here, name) => Err(format!("'textus {name}' has nothing to run.")),
    };
    result.unwrap_or_else(|why| {
        io.warn(&why);
        1
    })
}

fn version(io: &mut Io) -> i32 {
    io.line(&table::version_line());
    0
}

fn to_app(
    name: &str,
    args: Vec<String>,
    ctx: &Ctx,
    launch: bool,
    io: &mut Io,
    app: &dyn App,
) -> Result<i32, String> {
    let request = Request {
        command: name.to_string(),
        args,
        cwd: ctx.cwd.to_string_lossy().into_owned(),
        json: ctx.json,
    };
    app.send(&request, launch, io)
        .unwrap_or_else(|| Err("Textus isn't running.".into()))
}

/// A word that is no command of the table's: a plugin's tool while the app
/// runs, else a mistake.
fn plugin_command(
    word: &str,
    mut args: Vec<String>,
    ctx: &Ctx,
    help_asked: bool,
    io: &mut Io,
    app: &dyn App,
) -> i32 {
    if help_asked {
        args.push("--help".into());
    }
    let request = Request {
        command: format!("{}{word}", tool_args::PLUGIN_PREFIX),
        args,
        cwd: ctx.cwd.to_string_lossy().into_owned(),
        json: ctx.json,
    };
    match app.send(&request, false, io) {
        Some(Ok(code)) => code,
        Some(Err(why)) => {
            io.warn(&why);
            1
        }
        None => {
            io.warn(&format!(
                "'{word}' is not a textus command. See 'textus help'. \
                 (Plugins' commands work while Textus is running.)"
            ));
            2
        }
    }
}

fn help(topic: Option<&String>, io: &mut Io, app: &dyn App) -> i32 {
    if let Some(topic) = topic {
        if let Some(command) = table::find(topic).filter(|c| c.runs != Runs::NotYet) {
            io.text(&table::usage(command));
            return 0;
        }
        let ctx = Ctx {
            cwd: PathBuf::new(),
            json: false,
        };
        return plugin_command(topic, Vec::new(), &ctx, true, io, app);
    }
    let mut plugins = Vec::new();
    let request = Request {
        command: tool_args::LIST_TOOLS.into(),
        args: Vec::new(),
        cwd: String::new(),
        json: false,
    };
    let mut buffer = Io {
        out: &mut plugins,
        err: &mut std::io::sink(),
    };
    let listed = match app.send(&request, false, &mut buffer) {
        Some(Ok(0)) => String::from_utf8_lossy(&plugins).trim_end().to_string(),
        Some(_) => "  (Textus didn't say which plugins add commands.)".to_string(),
        None => "  (Shown while Textus is running: start it with 'textus'.)".to_string(),
    };
    let listed = if listed.is_empty() {
        "  (None: no plugin that is on adds one.)".to_string()
    } else {
        listed
    };
    io.text(&table::overview(&listed));
    0
}
