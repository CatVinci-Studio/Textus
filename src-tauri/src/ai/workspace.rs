use crate::ai::builtin;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Everything that shapes Textus AI for the document being edited: the
/// project folder, its `.textus/` folder and the global config folder. The
/// user-facing names and rules are in docs/design/ai-concepts.md; in code the
/// project folder is still called the workspace root.
///
/// The project folder is the document's own folder unless the user chose
/// another one, and its `.textus/` directory holds the project's settings:
///
/// ```text
/// my-novel/                 <- the project folder
/// ├── chapter-1.md          <- the open document
/// └── .textus/
///     ├── agent.md          <- the project's writing instructions (system prompt)
///     ├── style.md          <- the style profile (ai::project)
///     ├── library/          <- the library (ai::project)
///     └── skills/
///         └── polish.md     <- one skill per file: YAML frontmatter + prompt body
/// ```
///
/// The global config folder lives in the app config dir under `agent/` with
/// the agent.md + skills/ half of that shape and applies to every document:
/// its writing instructions come first and the project's after them, and a
/// project skill with the same name shadows the global one. Skill files are
/// markdown with a frontmatter block:
///
/// ```text
/// ---
/// name: polish
/// description: Tighten prose without changing meaning
/// ---
/// (full instructions the model loads on demand)
/// ```
///
/// Only `name` + `description` go into the system prompt (the skill index);
/// the body is loaded dynamically via the `use_skill` tool.
pub const WORKSPACE_DIR_NAME: &str = ".textus";

/// Where a project's settings live: `<project folder>/.textus/`. Only this
/// folder counts - a Levis project's `.levis/` is never read; the project
/// bar offers to convert it once (ai::levis_project).
pub fn project_dir(root: &Path) -> PathBuf {
    root.join(WORKSPACE_DIR_NAME)
}

/// One project file, when it exists: `.textus/<rel>`.
pub fn project_file(root: &Path, rel: &str) -> Option<PathBuf> {
    Some(project_dir(root).join(rel)).filter(|path| path.is_file())
}

/// Who may start a skill (`metadata.textus-invocation`). `Both`: the model,
/// when a request matches the description, and the user with /name.
/// `UserOnly`: /name only - left out of the skill index the model sees.
/// `Hidden`: neither; loaded by exact name with use_skill (the reference
/// packs).
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Invocation {
    #[default]
    Both,
    UserOnly,
    Hidden,
}

/// Which layer a skill comes from: bundled with the app (ai::builtin), the
/// global config folder's skills/, or the project's .textus/skills/. Each
/// layer replaces same-named skills of the ones before it.
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SkillSource {
    Builtin,
    #[default]
    Global,
    Project,
}

/// One skill as the app sees it: the frontmatter's name and description,
/// the body (`prompt`, comments stripped) and the Textus-only keys under
/// `metadata:` (see docs in parse_skill_file). Serialised camelCase for
/// the frontend's skill list (src/ai/types.ts).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    pub name: String,
    pub description: String,
    pub prompt: String,
    /// `textus-category`: write, revise, check or format (the `/` menu's
    /// groups). None for a user skill that doesn't say.
    pub category: Option<String>,
    pub invocation: Invocation,
    pub source: SkillSource,
    /// A global or project skill with a built-in skill's name, which it
    /// replaces.
    pub overrides_builtin: bool,
    /// False for a built-in skill the user turned off in Settings
    /// (`disabledBuiltinSkills`); always true for the user's own skills.
    pub enabled: bool,
    /// Extra words the user can type after `/`, per UI language code
    /// (src/i18n/langs.ts): `textus-aliases-<code>`, comma-separated.
    pub aliases: BTreeMap<String, Vec<String>>,
    /// `textus-packs`: the reference-pack sections appended to the body when
    /// the skill is used ("contract", "craft#fiction", "standards#dialogue"
    /// for the document's language) - see ai::builtin::expand_skill.
    pub packs: Vec<String>,
    /// `textus-version` of a built-in skill (bumped when its behaviour
    /// changes).
    pub version: Option<String>,
    /// `textus-based-on: "<name>@<version>"`, written into a copy made with
    /// Customize… - what makes Reset allowed to delete it.
    pub based_on: Option<String>,
    /// A customized copy whose built-in has a newer version since.
    pub builtin_updated: bool,
    /// `textus-target-packs`: sections of the TARGET language's pack to
    /// attach when the request names one (translate).
    #[serde(skip)]
    pub target_packs: Vec<String>,
}

impl Default for AgentSkill {
    fn default() -> Self {
        AgentSkill {
            name: String::new(),
            description: String::new(),
            prompt: String::new(),
            category: None,
            invocation: Invocation::Both,
            source: SkillSource::Global,
            overrides_builtin: false,
            enabled: true,
            aliases: BTreeMap::new(),
            packs: Vec::new(),
            version: None,
            based_on: None,
            builtin_updated: false,
            target_packs: Vec::new(),
        }
    }
}

impl AgentSkill {
    /// Whether the model is told about this skill in the skill index and
    /// may load it by description.
    pub fn offered_to_model(&self) -> bool {
        self.enabled && self.invocation == Invocation::Both
    }
}

#[derive(Serialize, Clone, Default)]
pub struct AgentWorkspace {
    /// The global writing instructions (the global config folder's
    /// agent.md, comments stripped), in prompt order.
    pub instructions: Vec<String>,
    /// The project's writing instructions (`.textus/agent.md`), sent after
    /// the global ones and winning where the two conflict.
    pub project_instructions: Option<String>,
    /// Merged skills: the built-in ones (turned-off ones included, with
    /// `enabled: false`, so Settings can list them), then the global
    /// config folder's, then the project's, each replacing same-named
    /// skills of the layers before it. The reference packs are not here
    /// (ai::builtin::packs).
    pub skills: Vec<AgentSkill>,
    /// The project folder - the document's own by default, or the one
    /// picked in the panel - when there is one: the sandbox root for the
    /// agent's file tools. None for an unsaved draft, and for a folder too
    /// broad to expose (the home directory or a filesystem root).
    pub root: Option<String>,
    /// `.textus/style.md` - the author's style profile.
    pub style: Option<String>,
    /// `.textus/library/*.md` - the project's people, places and terms.
    pub library: Vec<crate::ai::project::LibraryEntry>,
    /// Where `root` came from - or why there is none - so the agent can
    /// tell the user which folder it reads and how to change that.
    pub root_source: RootSource,
    /// The writing conventions the style profile's front matter sets
    /// (`conventions: zh-Hans-CN/fiction`, option keys) - rules::profile.
    pub conventions: crate::ai::rules::ProjectConventions,
    /// What Textus AI remembered by itself, personal and the project's
    /// (ai::memory), with which of them fit in the prompt.
    pub memories: crate::ai::memory::Memories,
    /// Whether Textus AI may remember things by itself: the `remember`
    /// tool is offered only then (Settings > Textus AI > Remember
    /// automatically, settings.json's `rememberAutomatically`).
    pub remember: bool,
    /// The project folder has a Levis project's `.levis/` with files its
    /// `.textus/` lacks: the project bar offers to convert it
    /// (ai::levis_project).
    pub levis_project: bool,
}

impl AgentWorkspace {
    /// Whether any skill can be used at all (use_skill also loads the
    /// reference packs, but only skills ask for those).
    pub fn has_usable_skills(&self) -> bool {
        self.skills.iter().any(|s| s.enabled)
    }
}

/// Why the workspace root (the project folder, to the user) is the one it
/// is, or why there is none.
#[derive(Serialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum RootSource {
    /// An unsaved document and no folder chosen.
    #[default]
    None,
    /// The open document's own folder - the default.
    DocumentFolder,
    /// The nearest folder above the document that has a `.textus/` folder.
    EnclosingProject,
    /// The folder the user chose (the project menu, or Settings > Textus AI).
    Chosen,
    /// The folder would be the home folder or a drive root, which is never
    /// opened to the agent (project::is_too_broad).
    TooBroad,
}

pub(crate) fn global_agent_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("agent"))
}

/// A skill file's frontmatter: the top-level `key: value` pairs and the
/// `metadata:` map's (Agent Skills keeps tool-specific keys there, string
/// values only).
#[derive(Default, Debug)]
pub(crate) struct Frontmatter {
    pub fields: BTreeMap<String, String>,
    pub metadata: BTreeMap<String, String>,
}

/// Splits a skill file into its frontmatter and body. No frontmatter (or an
/// unterminated one) means the whole file is the body. Tolerates a BOM and
/// CRLF line ends.
pub(crate) fn split_frontmatter(content: &str) -> (Option<Frontmatter>, String) {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let lines: Vec<&str> = content.split('\n').collect();
    let is_fence = |line: &str| line.trim_end_matches('\r').trim_end() == "---";
    if lines.first().is_none_or(|l| !is_fence(l)) {
        return (None, content.to_string());
    }
    let Some(close) = lines
        .iter()
        .skip(1)
        .position(|l| is_fence(l) || l.trim_end_matches('\r').trim_end() == "...")
        .map(|i| i + 1)
    else {
        return (None, content.to_string());
    };
    let header: Vec<String> = lines[1..close]
        .iter()
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();
    let body = lines[close + 1..].join("\n");
    let mut fm = Frontmatter::default();
    for (key, value) in parse_yaml_map(&header) {
        match value {
            YamlValue::Scalar(v) => {
                fm.fields.insert(key, v);
            }
            YamlValue::Map(lines) if key == "metadata" => {
                for (k, v) in parse_yaml_map(&dedent(&lines)) {
                    if let YamlValue::Scalar(v) = v {
                        fm.metadata.insert(k, v);
                    }
                }
            }
            YamlValue::Map(_) => {}
        }
    }
    (Some(fm), body)
}

enum YamlValue {
    Scalar(String),
    /// A nested block (a map or a list), as its raw lines.
    Map(Vec<String>),
}

/// The small subset of YAML skill frontmatter uses: `key: value` at the
/// block's left edge; plain, single- and double-quoted scalars (plain ones
/// may continue on indented lines); block scalars (`|`, `>`, with `-`/`+`
/// chomping); and nested blocks, returned raw. Comments and anything else
/// are skipped. Hand-written rather than a YAML dependency: this is all a
/// skill file needs, and a mistake in one only costs that file's metadata.
fn parse_yaml_map(lines: &[String]) -> Vec<(String, YamlValue)> {
    let indented = |l: &str| l.starts_with(' ') || l.starts_with('\t');
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = &lines[i];
        i += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || indented(line) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        let value = value.trim();
        // The block under this key: every following indented or blank line.
        let start = i;
        while i < lines.len() && (lines[i].trim().is_empty() || indented(&lines[i])) {
            i += 1;
        }
        let mut block: Vec<String> = lines[start..i].to_vec();
        while block.last().is_some_and(|l| l.trim().is_empty()) {
            block.pop();
        }
        let value = match value {
            "" => {
                let nested = block.iter().find(|l| !l.trim().is_empty());
                match nested {
                    None => YamlValue::Scalar(String::new()),
                    Some(first) if first.trim_start().starts_with("- ") || first.contains(':') => {
                        YamlValue::Map(block)
                    }
                    Some(_) => YamlValue::Scalar(fold_plain("", &block)),
                }
            }
            v if v.starts_with('|') || v.starts_with('>') => {
                let text = dedent(&block);
                YamlValue::Scalar(if v.starts_with('|') {
                    text.join("\n").trim_end().to_string()
                } else {
                    fold_lines(&text)
                })
            }
            v if v.starts_with('"') || v.starts_with('\'') => {
                let mut raw = v.to_string();
                for l in &block {
                    raw.push(' ');
                    raw.push_str(l.trim());
                }
                YamlValue::Scalar(unquote(&raw))
            }
            v => YamlValue::Scalar(fold_plain(v, &block)),
        };
        out.push((key, value));
    }
    out
}

/// A plain scalar and its continuation lines, folded into one line, minus a
/// trailing ` # comment`.
fn fold_plain(first: &str, rest: &[String]) -> String {
    let mut parts: Vec<&str> = vec![first];
    parts.extend(rest.iter().map(|l| l.trim()));
    let joined = parts
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    match joined.find(" #") {
        Some(at) => joined[..at].trim_end().to_string(),
        None => joined,
    }
}

/// Folded block scalar (`>`): lines join with spaces, a blank line becomes
/// a line break.
fn fold_lines(lines: &[String]) -> String {
    let mut out = String::new();
    let mut pending_break = false;
    for line in lines {
        let line = line.trim_end();
        if line.is_empty() {
            pending_break = true;
            continue;
        }
        if !out.is_empty() {
            out.push(if pending_break { '\n' } else { ' ' });
        }
        pending_break = false;
        out.push_str(line);
    }
    out
}

/// The block's lines with their common indentation removed.
fn dedent(lines: &[String]) -> Vec<String> {
    let indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start_matches([' ', '\t']).len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l[indent..].to_string()
            }
        })
        .collect()
}

/// A quoted scalar's value: `"..."` with backslash escapes, `'...'` with
/// `''` for a quote. Whatever follows the closing quote is dropped.
fn unquote(raw: &str) -> String {
    let mut chars = raw.chars();
    let quote = chars.next().unwrap_or('"');
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match (quote, c) {
            ('"', '\\') => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => {}
            },
            ('\'', '\'') => {
                if chars.as_str().starts_with('\'') {
                    chars.next();
                    out.push('\'');
                } else {
                    return out;
                }
            }
            ('"', '"') => return out,
            _ => out.push(c),
        }
    }
    out
}

/// Parses a skill file. A file without frontmatter is still a valid skill:
/// the file stem becomes its name and the whole file its prompt. Only the
/// top-level `name` names the skill (a `name:` nested under `metadata:`
/// doesn't), spaces in it become `-` so `/name` stays one token, and
/// `<!-- -->` comments in the body are stripped like those in agent.md.
///
/// The Textus keys under `metadata:` (all optional; built-in skills set them
/// all): `textus-version`, `textus-invocation` (both, user-only, hidden),
/// `textus-category`, `textus-packs` and `textus-target-packs` (space-separated
/// pack references), `textus-aliases-<ui language>` (comma-separated),
/// `textus-based-on` (a Customize… copy) and `textus-sources` (credits, not
/// read). A skill written for Levis says `levis-` instead (a Customize… copy
/// brought over by Import from Levis, a converted Levis project's skills);
/// that prefix is read the same, `textus-` winning where a file has both.
/// Claude Code's top-level `disable-model-invocation: true` also makes a
/// skill /name-only.
/// The prefix of the app's own keys under a skill's `metadata:`.
const META_PREFIX: &str = "textus";
/// The same keys as Levis wrote them.
const LEGACY_META_PREFIX: &str = "levis";

pub(crate) fn parse_skill_file(file_stem: &str, content: &str) -> AgentSkill {
    let (frontmatter, body) = split_frontmatter(content);
    let fm = frontmatter.unwrap_or_default();
    let mut skill = AgentSkill {
        name: file_stem.to_string(),
        prompt: strip_html_comments(&body).trim().to_string(),
        ..AgentSkill::default()
    };
    if let Some(name) = fm.fields.get("name").map(|n| n.trim()) {
        if !name.is_empty() {
            skill.name = name.split_whitespace().collect::<Vec<_>>().join("-");
        }
    }
    skill.description = fm
        .fields
        .get("description")
        .map(|d| d.trim().to_string())
        .unwrap_or_default();
    if fm.fields.get("disable-model-invocation").map(|v| v.trim()) == Some("true") {
        skill.invocation = Invocation::UserOnly;
    }
    let meta = |key: &str| {
        let get = |prefix: &str| {
            fm.metadata
                .get(&format!("{prefix}-{key}"))
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
        };
        get(META_PREFIX).or_else(|| get(LEGACY_META_PREFIX))
    };
    if let Some(invocation) = meta("invocation") {
        skill.invocation = match invocation.to_ascii_lowercase().as_str() {
            "user-only" | "user_only" | "useronly" | "user" => Invocation::UserOnly,
            "hidden" => Invocation::Hidden,
            _ => Invocation::Both,
        };
    }
    skill.category = meta("category").map(str::to_string);
    skill.version = meta("version").map(str::to_string);
    skill.based_on = meta("based-on").map(str::to_string);
    let words = |v: Option<&str>| {
        v.map(|v| v.split_whitespace().map(str::to_string).collect())
            .unwrap_or_default()
    };
    skill.packs = words(meta("packs"));
    skill.target_packs = words(meta("target-packs"));
    // Legacy keys first, so a `textus-` list for the same language wins.
    let mut alias_keys: Vec<(&str, &String)> = fm
        .metadata
        .iter()
        .filter_map(|(key, value)| {
            let lang = key
                .strip_prefix(LEGACY_META_PREFIX)?
                .strip_prefix("-aliases-")?;
            Some((lang, value))
        })
        .collect();
    alias_keys.extend(fm.metadata.iter().filter_map(|(key, value)| {
        let lang = key.strip_prefix(META_PREFIX)?.strip_prefix("-aliases-")?;
        Some((lang, value))
    }));
    for (lang, value) in alias_keys {
        let mut list: Vec<String> = Vec::new();
        for alias in value.split([',', '，']).map(str::trim) {
            if !alias.is_empty()
                && !list
                    .iter()
                    .any(|a| a.to_lowercase() == alias.to_lowercase())
            {
                list.push(alias.to_string());
            }
        }
        if !list.is_empty() {
            skill.aliases.insert(lang.to_string(), list);
        }
    }
    skill
}

/// Strips `<!-- -->` comments from a `.textus/` file or the global agent.md
/// before it goes anywhere near a prompt: the starter templates explain
/// themselves in comments, and users get a natural way to annotate their
/// files ("comments are never sent" holds for every one of them). An
/// unterminated comment swallows the rest of the file, matching how HTML
/// would parse it.
pub(crate) fn strip_html_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        match rest[start..].find("-->") {
            Some(end) => rest = &rest[start + end + 3..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// Reads one layer (the global config folder or a project's .textus dir):
/// its agent.md and every skill under skills/, marked as coming from
/// `source`. Missing files/dirs are just empty layers, never errors - most
/// folders won't have any configuration.
fn read_layer(dir: &Path, source: SkillSource) -> (Option<String>, Vec<AgentSkill>) {
    let instructions = std::fs::read_to_string(dir.join("agent.md"))
        .ok()
        .map(|s| strip_html_comments(&s).trim().to_string())
        .filter(|s| !s.is_empty());
    let skills = read_skill_files(&dir.join("skills"))
        .into_iter()
        .map(|(_, mut skill)| {
            skill.source = source;
            mark_override(&mut skill);
            skill
        })
        .collect();
    (instructions, skills)
}

/// Every skill file in a skills/ folder with its path, in file-name order;
/// files with no instructions are skipped.
fn read_skill_files(skills_dir: &Path) -> Vec<(PathBuf, AgentSkill)> {
    let Ok(entries) = std::fs::read_dir(skills_dir) else {
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
            let stem = path.file_stem().and_then(|s| s.to_str())?.to_string();
            let content = std::fs::read_to_string(&path).ok()?;
            let skill = parse_skill_file(&stem, &content);
            (!skill.prompt.is_empty()).then_some((path, skill))
        })
        .collect()
}

/// Notes on a user skill that it replaces the built-in skill of its name,
/// and whether that built-in has changed since the skill was copied from
/// it (Customize… writes `textus-based-on: "<name>@<version>"`).
fn mark_override(skill: &mut AgentSkill) {
    let Some(builtin) = builtin::find(&skill.name) else {
        return;
    };
    skill.overrides_builtin = true;
    let copied = skill
        .based_on
        .as_deref()
        .and_then(|b| b.strip_prefix(&format!("{}@", builtin.name)))
        .and_then(|v| v.trim().parse::<u32>().ok());
    let current = builtin
        .version
        .as_deref()
        .and_then(|v| v.parse::<u32>().ok());
    skill.builtin_updated = matches!((copied, current), (Some(c), Some(n)) if c < n);
}

/// Adds a layer's skill on top of the ones before it, replacing any of the
/// same name.
fn push_layer_skill(skills: &mut Vec<AgentSkill>, skill: AgentSkill) {
    skills.retain(|s| s.name != skill.name);
    skills.push(skill);
}

/// The built-in skills the user turned off in Settings > Textus AI > Skills
/// (settings.json's `disabledBuiltinSkills`).
fn disabled_builtin_skills(app: &AppHandle) -> Vec<String> {
    crate::settings::read_setting(app, DISABLED_BUILTINS_KEY)
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

/// The settings.json field listing the built-in skills turned off.
pub(crate) const DISABLED_BUILTINS_KEY: &str = "disabledBuiltinSkills";

/// Resolves the workspace root - the project folder: the folder `.textus/`
/// is read from and the sandbox boundary the `list_files`/`read_file` tools
/// may not escape.
///
/// `root_override` is the chosen project folder ("Choose project folder…"
/// in the project bar, or Settings > Textus AI > Project Folder) - one
/// setting for every document, unsaved drafts included. Without it, the
/// project is the nearest folder holding the document that has a `.textus/`
/// folder (enclosing_project), else the document's own folder: a chapter in
/// `novel/part-1/` belongs to `novel/` once `novel/.textus/` exists, and a
/// folder of chapters with notes next to the draft needs nothing at all.
///
/// An override that no longer exists (a moved or unmounted folder) falls
/// back to the document's project rather than leaving the agent with no
/// workspace at all.
fn resolve_root(doc_path: Option<&str>, root_override: Option<&str>) -> Option<PathBuf> {
    let picked = root_override
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    picked.or_else(|| {
        let folder = document_folder(doc_path)?;
        Some(enclosing_project(folder).unwrap_or_else(|| folder.to_path_buf()))
    })
}

fn document_folder(doc_path: Option<&str>) -> Option<&Path> {
    doc_path
        .map(Path::new)
        .and_then(|p| p.parent())
        .filter(|p| !p.as_os_str().is_empty())
}

/// The nearest folder from `folder` upwards that is a project: one holding
/// a `.textus/` folder, or the folder above `.textus/` itself - a file of
/// the project's own (.textus/library/Lin.md, opened from the Memory tab)
/// belongs to it; left at its own folder, the panel took .textus/library
/// for the project and showed an empty library right after New library
/// entry. The walk stops before the home folder and a drive root, which
/// are never a project (project::is_too_broad) - a `.textus/` there would
/// make every document under it part of one.
fn enclosing_project(folder: &Path) -> Option<PathBuf> {
    for dir in folder.ancestors() {
        if dir.file_name().and_then(|n| n.to_str()) == Some(WORKSPACE_DIR_NAME) {
            return dir.parent().map(Path::to_path_buf);
        }
        if crate::ai::project::is_too_broad(dir) {
            return None;
        }
        if project_dir(dir).is_dir() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

/// The project folder the agent may read: the resolved root, unless it is
/// too broad to treat as one (a home folder, a drive root).
pub(crate) fn project_root(doc_path: Option<&str>, root_override: Option<&str>) -> Option<PathBuf> {
    resolve_root(doc_path, root_override).filter(|root| !crate::ai::project::is_too_broad(root))
}

/// Loads the merged agent workspace for a document: the built-in skills,
/// then the global config folder, then the project folder's `.textus/`
/// layer on top.
pub fn load(
    app: &AppHandle,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    AgentWorkspace {
        remember: crate::ai::memory::remember_enabled(app),
        ..load_layers(
            global_agent_dir(app).ok().as_deref(),
            doc_path,
            root_override,
            &disabled_builtin_skills(app),
        )
    }
}

/// [`load`] with the global layer's folder given directly and no built-in
/// skill turned off - the live eval's loader, which builds real workspaces
/// on disk to exercise exactly this path.
#[cfg(test)]
pub(crate) fn load_from(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    load_layers(global_dir, doc_path, root_override, &[])
}

/// The three skill layers: built-in < global < project, by name. A
/// built-in in `disabled` stays in the list, turned off, so Settings can
/// show it; a user skill of the same name still replaces it.
pub(crate) fn load_layers(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
    disabled: &[String],
) -> AgentWorkspace {
    let mut ws = AgentWorkspace {
        skills: builtin::skills()
            .iter()
            .map(|s| AgentSkill {
                enabled: !disabled.contains(&s.name),
                ..s.clone()
            })
            .collect(),
        ..AgentWorkspace::default()
    };

    if let Some(global_dir) = global_dir {
        let (instructions, skills) = read_layer(global_dir, SkillSource::Global);
        ws.instructions.extend(instructions);
        for skill in skills {
            push_layer_skill(&mut ws.skills, skill);
        }
    }

    let resolved = resolve_root(doc_path, root_override);
    let chosen = root_override
        .map(str::trim)
        .is_some_and(|p| !p.is_empty() && Path::new(p).is_dir());
    ws.root_source = match &resolved {
        None => RootSource::None,
        Some(root) if crate::ai::project::is_too_broad(root) => RootSource::TooBroad,
        Some(_) if chosen => RootSource::Chosen,
        Some(root) if Some(root.as_path()) != document_folder(doc_path) => {
            RootSource::EnclosingProject
        }
        Some(_) => RootSource::DocumentFolder,
    };
    let root = resolved.filter(|_| ws.root_source != RootSource::TooBroad);
    if let Some(root) = root.as_deref() {
        ws.root = Some(root.to_string_lossy().to_string());
        ws.style = crate::ai::project::read_style(root);
        ws.conventions = crate::ai::project::style_conventions(ws.style.as_deref());
        ws.library = crate::ai::project::read_library(root);
        ws.levis_project = crate::ai::levis_project::unconverted(root);
        let (instructions, skills) = read_layer(&project_dir(root), SkillSource::Project);
        ws.project_instructions = instructions;
        // Project skills shadow same-named global and built-in ones.
        for skill in skills {
            push_layer_skill(&mut ws.skills, skill);
        }
    }
    ws.memories = crate::ai::memory::MemoryDirs::new(global_dir, root.as_deref()).load();

    // A copy made by Customize… is still that built-in as far as the
    // switch in Settings goes: turning the built-in off turns the copy off.
    // A skill the user wrote by hand with the same name is theirs and stays.
    for skill in &mut ws.skills {
        if skill.based_on.is_some() && disabled.contains(&skill.name) {
            skill.enabled = false;
        }
    }

    ws
}

/// The workspace as the frontend needs it: the skill list for the `/name`
/// picker in the chat input, plus the resolved project folder (`root`),
/// style profile and library the project bar shows. Loaded fresh each time
/// the chat opens so file edits are picked up without restarting.
#[tauri::command]
pub async fn load_agent_workspace(
    app: AppHandle,
    doc_path: Option<String>,
    root_override: Option<String>,
) -> AgentWorkspace {
    tauri::async_runtime::spawn_blocking(move || {
        load(&app, doc_path.as_deref(), root_override.as_deref())
    })
    .await
    .unwrap_or_default()
}

/// Every skill for a document as the `/` menu and Settings list it:
/// built-ins (turned-off ones too, with `enabled: false`), then the global
/// folder's, then the project's, each replacing same-named ones. Hidden
/// skills are left out. Both arguments None (Settings) gives the built-ins
/// and the global skills.
#[tauri::command]
pub async fn list_skills(
    app: AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Vec<AgentSkill> {
    tauri::async_runtime::spawn_blocking(move || {
        listed(load(&app, doc_path.as_deref(), workspace_root.as_deref()).skills)
    })
    .await
    .unwrap_or_default()
}

fn listed(skills: Vec<AgentSkill>) -> Vec<AgentSkill> {
    skills
        .into_iter()
        .filter(|s| s.invocation != Invocation::Hidden)
        .collect()
}

/// Folder picker behind "Choose project folder…" (the project bar's menu
/// and Settings > Textus AI > Project Folder). Desktop only: the dialog
/// plugin has no folder picker on iOS.
#[cfg(desktop)]
#[tauri::command]
pub async fn pick_workspace_root(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window).blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let picked = picked.map(|p| p.to_string());
    // The home directory or a drive root would hand the agent everything
    // the user owns; refuse it here, where the choice is made, with a reason
    // the panel can show.
    if picked
        .as_deref()
        .is_some_and(|p| crate::ai::project::is_too_broad(Path::new(p)))
    {
        return Err("TOO_BROAD".to_string());
    }
    Ok(picked)
}

/// Creates the global config folder (with a starter agent.md and skills/
/// folder on first use) and reveals it in the file manager - Settings >
/// Textus AI > Global Config Folder. Desktop only: iOS has no file manager to
/// reveal a folder in (the opener plugin only opens URLs there).
#[cfg(desktop)]
#[tauri::command]
pub async fn open_global_agent_dir(app: AppHandle, template: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = ensure_global_layer(&app, &template)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Creates the global config folder if needed (skills/ folder plus a
/// starter agent.md, same shape `open_global_agent_dir` guarantees) and
/// returns the agent.md path. Backs Settings > Textus AI > Writing
/// Instructions > Edit agent.md, which opens that file in the editor itself
/// - Textus IS a markdown editor, so there's no bespoke textarea for it.
#[tauri::command]
pub fn ensure_global_agent_md(app: AppHandle, template: String) -> Result<String, String> {
    Ok(ensure_global_layer(&app, &template)?
        .join("agent.md")
        .to_string_lossy()
        .to_string())
}

/// Guarantees the global config folder exists with its starter files;
/// returns it. `template` is the starter agent.md in the UI language
/// (`agentInstructionsTemplate` in src/i18n/locales/): a how-to written
/// entirely in HTML comments, which `read_layer` strips before anything
/// reaches the model - so it teaches without polluting the system prompt.
/// It is only written when there is no agent.md yet.
fn ensure_global_layer(app: &AppHandle, template: &str) -> Result<PathBuf, String> {
    let dir = global_agent_dir(app)?;
    std::fs::create_dir_all(dir.join("skills")).map_err(|e| e.to_string())?;
    let agent_md = dir.join("agent.md");
    if !agent_md.exists() {
        crate::atomic::write_sync(&agent_md, template).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Windows refuses these as file names whatever the extension ("con.md").
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file stem for a skill named `name`. The name comes from the imported
/// file's frontmatter, i.e. from whoever wrote that file: `name: ../../x`
/// must not become a path - see safe_file_stem.
fn skill_file_stem(name: &str) -> String {
    safe_file_stem(name, "skill", 120)
}

/// A file stem made from text someone else chose (a skill's name, what
/// Textus AI remembered): keeps letters (any script), digits, `-` and `_`,
/// turns everything else - separators, dots, control characters - into
/// `-`, and caps the length at `max_bytes`, well under any filesystem's
/// limit - counted in bytes, which is what that limit counts (255 on
/// most): a Chinese or Japanese character takes three, and the atomic
/// writer's temp name adds about 35 more. `fallback` stands in for an
/// empty stem, and is appended to a name Windows refuses.
pub(crate) fn safe_file_stem(name: &str, fallback: &str, max_bytes: usize) -> String {
    let mut stem = String::new();
    for c in name.chars() {
        let c = if c.is_alphanumeric() || c == '-' || c == '_' {
            c
        } else {
            '-'
        };
        if stem.len() + c.len_utf8() > max_bytes {
            break;
        }
        stem.push(c);
    }
    let stem = stem.trim_matches('-');
    if stem.is_empty() {
        fallback.to_string()
    } else if WINDOWS_RESERVED_NAMES.contains(&stem.to_lowercase().as_str()) {
        format!("{stem}-{fallback}")
    } else {
        stem.to_string()
    }
}

/// Where the skill `name` is stored in `skills_dir` - checked to really be
/// a file directly inside it, as a second line of defence behind
/// skill_file_stem.
fn skill_file_path(skills_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = skills_dir.join(format!("{}.md", skill_file_stem(name)));
    if path.parent() != Some(skills_dir) {
        return Err("That skill's name can't be used as a file name.".to_string());
    }
    Ok(path)
}

/// Copies a user-picked .md skill file into the global skills folder and
/// returns the refreshed global skill list (None if the dialog was
/// cancelled). The file is stored under the skill's resolved name, so
/// re-importing an updated copy replaces the old one instead of piling up.
#[tauri::command]
pub async fn import_agent_skill(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<Vec<AgentSkill>>, String> {
    let picked = {
        tauri::async_runtime::spawn_blocking(move || {
            crate::commands::fs::window_file_dialog(&window)
                .add_filter("Markdown", &["md"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let Some(src) = picked.map(|p| p.to_string()) else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let stem = Path::new(&src)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("skill")
        .to_string();
    let skill = parse_skill_file(&stem, &content);
    if skill.prompt.is_empty() {
        return Err("That file has no skill content.".to_string());
    }

    let global_dir = global_agent_dir(&app)?;
    let skills_dir = global_dir.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    let target = skill_file_path(&skills_dir, &skill.name)?;
    crate::atomic::write(&target, &content)
        .await
        .map_err(|e| e.to_string())?;

    let (_, skills) = read_layer(&global_dir, SkillSource::Global);
    Ok(Some(skills))
}

/// Errors the built-in skill commands return, for the frontend to map to
/// its own messages.
pub(crate) const UNKNOWN_BUILTIN: &str = "UNKNOWN_BUILTIN";
pub(crate) const NOT_A_COPY: &str = "NOT_A_COPY";

/// Settings > Textus AI > Skills > Customize…: copies a built-in skill into
/// the global config folder's skills/, where it replaces the built-in, and
/// returns the copy's path for the frontend to open in a tab. The copy
/// gains `textus-based-on: "<name>@<version>"` under `metadata:`, which is
/// what lets Reset delete it and Settings say when the built-in has changed.
/// An existing skill of that name - an earlier copy, or the user's own - is
/// never overwritten: its path is returned instead.
#[tauri::command]
pub async fn customize_builtin_skill(app: AppHandle, name: String) -> Result<String, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || customize_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn customize_in(skills_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let (Some(builtin), Some(raw)) = (builtin::find(name), builtin::raw(name)) else {
        return Err(UNKNOWN_BUILTIN.to_string());
    };
    if let Some((path, _)) = read_skill_files(skills_dir)
        .into_iter()
        .find(|(_, s)| s.name == builtin.name)
    {
        return Ok(path);
    }
    std::fs::create_dir_all(skills_dir).map_err(|e| e.to_string())?;
    // A file of that stem holding some other skill keeps its name.
    let mut path = skill_file_path(skills_dir, &builtin.name)?;
    let mut n = 2;
    while path.exists() {
        path = skill_file_path(skills_dir, &format!("{}-{n}", builtin.name))?;
        n += 1;
    }
    let version = builtin.version.as_deref().unwrap_or("1");
    let content = builtin::with_based_on(raw, &format!("{}@{version}", builtin.name));
    crate::atomic::write_sync(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Settings > Textus AI > Skills > Reset to built-in: deletes the global
/// copies Customize… made of a built-in skill (those carrying
/// `textus-based-on`), so the built-in applies again. A same-named skill the
/// user wrote or imported themselves is theirs: NOT_A_COPY, nothing
/// deleted. Nothing to delete is not an error. Returns the deleted files'
/// paths, so the frontend can close a tab still showing one: saving that
/// tab would quietly write the copy back.
#[tauri::command]
pub async fn reset_builtin_skill(app: AppHandle, name: String) -> Result<Vec<String>, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || reset_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn reset_in(skills_dir: &Path, name: &str) -> Result<Vec<String>, String> {
    if builtin::find(name).is_none() {
        return Err(UNKNOWN_BUILTIN.to_string());
    }
    let prefix = format!("{name}@");
    let same_name: Vec<(PathBuf, AgentSkill)> = read_skill_files(skills_dir)
        .into_iter()
        .filter(|(_, s)| s.name == name)
        .collect();
    let copies: Vec<&PathBuf> = same_name
        .iter()
        .filter(|(_, s)| {
            s.based_on
                .as_deref()
                .is_some_and(|b| b.starts_with(&prefix))
        })
        .map(|(p, _)| p)
        .collect();
    if copies.is_empty() && !same_name.is_empty() {
        return Err(NOT_A_COPY.to_string());
    }
    let mut deleted = Vec::new();
    for path in copies {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        deleted.push(path.to_string_lossy().to_string());
    }
    Ok(deleted)
}

/// Turns a built-in skill on or off (Settings > Textus AI > Skills): kept in
/// settings.json as `disabledBuiltinSkills`, broadcast to every window like
/// any settings change. Returns the new list.
#[tauri::command]
pub fn set_builtin_skill_enabled(
    app: AppHandle,
    name: String,
    enabled: bool,
) -> Result<Vec<String>, String> {
    if builtin::find(&name).is_none() {
        return Err(UNKNOWN_BUILTIN.to_string());
    }
    let list = toggled_builtins(&disabled_builtin_skills(&app), &name, enabled);
    let mut patch = serde_json::Map::new();
    patch.insert(
        DISABLED_BUILTINS_KEY.to_string(),
        serde_json::Value::from(list.clone()),
    );
    crate::settings::patch_from_backend(&app, patch);
    Ok(list)
}

/// The disabled list after turning `name` on or off: sorted, no repeats,
/// and only names that are still built-in skills.
fn toggled_builtins(current: &[String], name: &str, enabled: bool) -> Vec<String> {
    let mut list: Vec<String> = current
        .iter()
        .filter(|n| n.as_str() != name && builtin::find(n).is_some())
        .cloned()
        .collect();
    if !enabled {
        list.push(name.to_string());
    }
    list.sort();
    list.dedup();
    list
}

#[cfg(test)]
mod tests;
