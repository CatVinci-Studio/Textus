//! Every `textus` command, its usage and a line about it: what `textus help`
//! prints, and how each one runs.

/// Where a command runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Runs {
    /// In this process, without the app.
    Here,
    /// In the running app, which is started first if it isn't.
    App,
    /// Handed to the app the way a file manager opens files.
    Open,
    /// Kept for later; says so and is left out of help.
    NotYet,
}

pub struct Command {
    pub name: &'static str,
    pub usage: &'static str,
    pub summary: &'static str,
    /// More lines for `textus help <command>`.
    pub details: &'static str,
    pub runs: Runs,
}

pub const COMMANDS: &[Command] = &[
    Command {
        name: "open",
        usage: "textus open [<file or folder>...]",
        summary: "Open files or folders in Textus (also: textus <path>...)",
        details: "With nothing to open, brings Textus to the front.",
        runs: Runs::Open,
    },
    Command {
        name: "list",
        usage: "textus list [<folder>] [--json]",
        summary: "List the notes and documents in a folder",
        details: "Lists what Textus AI can read there: text files and documents \
                  (PDF, Word, ...), leaving out hidden and ignored files.\n\
                  The folder is the current one when left out.",
        runs: Runs::Here,
    },
    Command {
        name: "read",
        usage: "textus read <file> [--json]",
        summary: "Print a file as Markdown, converting PDF, Word, EPUB and more",
        details: "Markdown and text print as they are; PDF, DOCX, PPTX, XLSX, \
                  EPUB, RTF and HTML print as the Markdown Textus reads from them.",
        runs: Runs::Here,
    },
    Command {
        name: "search",
        usage: "textus search <query> [<folder>] [--json]",
        summary: "Find the lines in a folder's files that contain words",
        details: "Ignores case. Looks inside text files and documents, as \
                  `textus list` lists them. Exits with 1 when nothing matches.",
        runs: Runs::Here,
    },
    Command {
        name: "new",
        usage: "textus new <file> [--title <title>]",
        summary: "Create a Markdown file",
        details: "Adds .md to a name without an extension. Never replaces a file \
                  that is already there.",
        runs: Runs::Here,
    },
    Command {
        name: "move",
        usage: "textus move <from> <to>",
        summary: "Move or rename a file or folder",
        details: "Into <to> when it is a folder. Never replaces anything already \
                  there, and doesn't move between disks.",
        runs: Runs::Here,
    },
    Command {
        name: "export",
        usage: "textus export <file> --to <format> [--out <file>]",
        summary: "Export a document as PDF, HTML, Word and more, through Textus",
        details: "Formats: pdf, html, docx, odt, rtf, epub, latex, mediawiki, rst, \
                  textile, opml (all but pdf and html need pandoc).\n\
                  Saves next to the document unless --out says where, and never \
                  replaces a file. Opens the document in Textus to export it.",
        runs: Runs::App,
    },
    Command {
        name: "commands",
        usage: "textus commands [list | run <id>] [--json]",
        summary: "List the command palette's commands, or run one",
        details: "Plugins' commands included. Runs in the Textus window in front.",
        runs: Runs::App,
    },
    Command {
        name: "plugin",
        usage: "textus plugin list | install <id or path> | enable <id> | disable <id> [--json]",
        summary: "List, install, turn on or turn off plugins",
        details: "install takes a plugin from the store by its id, or a package or \
                  folder by its path. Turning one on asks for its permissions in Textus.",
        runs: Runs::App,
    },
    Command {
        name: "theme",
        usage: "textus theme list | set <id> [--json]",
        summary: "List the editor themes, or choose one",
        details: "",
        runs: Runs::App,
    },
    Command {
        name: "skill",
        usage: "textus skill list [--json]",
        summary: "List Textus AI's skills",
        details: "",
        runs: Runs::App,
    },
    Command {
        name: "help",
        usage: "textus help [<command>]",
        summary: "Show this list, or how to use one command",
        details: "",
        runs: Runs::Here,
    },
    Command {
        name: "version",
        usage: "textus version",
        summary: "Print the version of Textus",
        details: "Also: textus --version, textus -V",
        runs: Runs::Here,
    },
    Command {
        name: "ai",
        usage: "textus ai",
        summary: "Textus AI from the terminal",
        details: "",
        runs: Runs::NotYet,
    },
    Command {
        name: "research",
        usage: "textus research",
        summary: "Research mode from the terminal",
        details: "",
        runs: Runs::NotYet,
    },
];

pub fn find(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|c| c.name == name)
}

pub fn version_line() -> String {
    format!("Textus {}", env!("CARGO_PKG_VERSION"))
}

/// `textus help`: every command but the ones kept for later, then the plugin
/// commands, or `plugins` saying why there are none to show.
pub fn overview(plugins: &str) -> String {
    let width = COMMANDS.iter().map(|c| c.name.len()).max().unwrap_or(0);
    let mut out = format!(
        "{} - the next-generation Markdown editor, made for writing with AI\n\n\
         Usage: textus [<file or folder>...]\n\
         \x20      textus <command> [<arguments>]\n\
         \x20      textus <plugin> <tool> [--<name> <value>...] [--json '<object>']\n\n\
         Commands:\n",
        version_line()
    );
    for c in COMMANDS.iter().filter(|c| c.runs != Runs::NotYet) {
        out.push_str(&format!("  {:width$}  {}\n", c.name, c.summary));
    }
    out.push_str("\nPlugin commands:\n");
    out.push_str(plugins);
    out.push_str(
        "\n\nRun 'textus help <command>' for one command's usage. Commands that \
         return data print JSON with --json.\n",
    );
    out
}

/// `textus help <command>` and `textus <command> --help`.
pub fn usage(c: &Command) -> String {
    let mut out = format!("Usage: {}\n\n{}.\n", c.usage, c.summary);
    if !c.details.is_empty() {
        out.push('\n');
        out.push_str(c.details);
        out.push('\n');
    }
    out
}
