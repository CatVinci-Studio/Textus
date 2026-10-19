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
mod tests {
    use super::*;

    #[test]
    fn strips_comments_leaving_instructions() {
        let text = "<!-- how-to guide -->\nReply in Chinese.\n<!-- note to self -->";
        assert_eq!(strip_html_comments(text).trim(), "Reply in Chinese.");
    }

    #[test]
    fn unterminated_comment_swallows_rest() {
        assert_eq!(strip_html_comments("keep <!-- open forever"), "keep ");
    }

    #[test]
    fn parses_frontmatter_skill() {
        let skill = parse_skill_file(
            "polish",
            "---\nname: tighten\ndescription: Tighten prose\n---\nRewrite the text to be tighter.",
        );
        assert_eq!(skill.name, "tighten");
        assert_eq!(skill.description, "Tighten prose");
        assert_eq!(skill.prompt, "Rewrite the text to be tighter.");
    }

    #[test]
    fn skill_without_frontmatter_uses_file_stem() {
        let skill = parse_skill_file("outline", "Make an outline of the document.");
        assert_eq!(skill.name, "outline");
        assert_eq!(skill.description, "");
        assert_eq!(skill.prompt, "Make an outline of the document.");
    }

    #[test]
    fn workspace_root_defaults_to_the_documents_folder() {
        assert_eq!(
            resolve_root(Some("/tmp/novel/chapter-1.md"), None),
            Some(PathBuf::from("/tmp/novel"))
        );
        assert_eq!(resolve_root(None, None), None);
        assert_eq!(
            resolve_root(Some("/tmp/novel/.textus/library/Lin.md"), None),
            Some(PathBuf::from("/tmp/novel"))
        );
        assert_eq!(
            resolve_root(Some("/tmp/novel/.textus/style.md"), None),
            Some(PathBuf::from("/tmp/novel"))
        );
    }

    #[test]
    fn an_explicit_root_wins_over_the_documents_folder() {
        // The whole point of the setting: sources and draft in different
        // folders. Uses a directory guaranteed to exist, since resolve_root
        // only honours an override that is really there.
        let existing = std::env::temp_dir();
        assert_eq!(
            resolve_root(
                Some("/tmp/novel/chapter-1.md"),
                Some(&existing.to_string_lossy())
            ),
            Some(existing)
        );
    }

    #[test]
    fn a_stale_root_falls_back_instead_of_leaving_no_workspace() {
        // A moved or unmounted folder must not cost the agent its skills and
        // file tools entirely - that would look like the feature breaking.
        assert_eq!(
            resolve_root(
                Some("/tmp/novel/chapter-1.md"),
                Some("/definitely/not/a/real/folder")
            ),
            Some(PathBuf::from("/tmp/novel"))
        );
        assert_eq!(
            resolve_root(Some("/tmp/novel/chapter-1.md"), Some("   ")),
            Some(PathBuf::from("/tmp/novel"))
        );
    }

    #[test]
    fn a_skill_name_cannot_escape_the_skills_folder() {
        let dir = Path::new("/config/agent/skills");
        for name in [
            "../../x",
            "..",
            "/etc/passwd",
            "a/../b",
            "..\\..\\win",
            "nul",
            "",
        ] {
            let path = skill_file_path(dir, name).unwrap();
            assert_eq!(path.parent(), Some(dir), "{name}");
            let file = path.file_name().unwrap().to_str().unwrap();
            assert!(!file.starts_with('.'), "{name} -> {file}");
            assert!(!file.contains(".."), "{name} -> {file}");
        }
        assert_eq!(skill_file_stem("../../x"), "x");
        assert_eq!(skill_file_stem("nul"), "nul-skill");
        assert_eq!(skill_file_stem("润色"), "润色");
        assert_eq!(skill_file_stem("fix-my_prose2"), "fix-my_prose2");
        // 100 Chinese characters are 300 bytes - past a 255-byte file name.
        let long = skill_file_stem(&"润".repeat(100));
        assert!(
            long.len() <= 120 && long.chars().all(|c| c == '润'),
            "{long}"
        );
        assert_eq!(skill_file_stem(&"a".repeat(300)).len(), 120);
    }

    #[test]
    fn block_scalar_descriptions_are_read_whole() {
        let literal = parse_skill_file(
            "x",
            "---\nname: x\ndescription: |\n  First line.\n  Second line.\nlicense: MIT\n---\nbody",
        );
        assert_eq!(literal.description, "First line.\nSecond line.");
        let folded = parse_skill_file(
            "x",
            "---\nname: x\ndescription: >-\n  Writes the next scene\n  of a story.\n\n  Use when asked.\n---\nbody",
        );
        assert_eq!(
            folded.description,
            "Writes the next scene of a story.\nUse when asked."
        );
        let plain = parse_skill_file(
            "x",
            "---\ndescription: Tighten prose\n  without losing facts # a comment\n---\nbody",
        );
        assert_eq!(plain.description, "Tighten prose without losing facts");
        let quoted = parse_skill_file(
            "x",
            "---\nname: 'it''s'\ndescription: \"Say \\\"hi\\\": politely\"\n---\nbody",
        );
        assert_eq!(quoted.name, "it's");
        assert_eq!(quoted.description, "Say \"hi\": politely");
    }

    #[test]
    fn a_name_nested_under_metadata_does_not_rename_the_skill() {
        let skill = parse_skill_file(
            "polish",
            "---\nname: polish\nmetadata:\n  name: other\n  textus-category: \"revise\"\n  textus-packs: \"contract standards#words\"\n  textus-aliases-zh: \"润色， 打磨, 润色\"\n  textus-invocation: user-only\ndescription: Polish\n---\nbody",
        );
        assert_eq!(skill.name, "polish");
        assert_eq!(skill.description, "Polish");
        assert_eq!(skill.category.as_deref(), Some("revise"));
        assert_eq!(skill.packs, ["contract", "standards#words"]);
        assert_eq!(skill.aliases["zh"], ["润色", "打磨"]);
        assert_eq!(skill.invocation, Invocation::UserOnly);
        // Without the frontmatter name, the nested one still doesn't count.
        let skill = parse_skill_file("polish", "---\nmetadata:\n  name: other\n---\nbody");
        assert_eq!(skill.name, "polish");
        // Lists and other nested blocks are skipped without harm.
        let skill = parse_skill_file(
            "x",
            "---\nallowed-tools:\n  - Read\n  - Grep\nname: listed\ndisable-model-invocation: true\n---\nbody",
        );
        assert_eq!(skill.name, "listed");
        assert_eq!(skill.invocation, Invocation::UserOnly);
    }

    #[test]
    fn comments_crlf_and_bom_are_handled() {
        let skill = parse_skill_file(
            "x",
            "\u{feff}---\r\nname: crlf\r\ndescription: Windows file\r\n---\r\n<!-- note to self -->\r\nDo the thing.\r\n",
        );
        assert_eq!(skill.name, "crlf");
        assert_eq!(skill.description, "Windows file");
        assert_eq!(skill.prompt.trim(), "Do the thing.");
        assert!(!skill.prompt.contains("note to self"));
        // An unterminated frontmatter is body, as before.
        let skill = parse_skill_file("stem", "---\nname: x\nno end");
        assert_eq!(skill.name, "stem");
        assert!(skill.prompt.contains("no end"));
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "textus-skills-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn a_levis_folder_is_never_read() {
        let root = scratch("legacy-dir");
        let project = root.join("novel");
        write(
            &project.join(".levis/skills/house.md"),
            "---\nname: house\ndescription: Levis-era skill\n---\nKeep it short.",
        );
        write(
            &project.join(".levis/agent.md"),
            "Write in British English.",
        );
        write(
            &project.join(".levis/library/lin.md"),
            "---\nname: Lin\n---\nLevis Lin.",
        );
        write(&project.join(".levis/style.md"), "Short sentences.");
        write(&project.join("chapter.md"), "# One");
        let doc = project.join("chapter.md");
        let ws = load_layers(None, doc.to_str(), None, &[]);
        assert_eq!(ws.root.as_deref(), project.to_str());
        assert!(ws.project_instructions.is_none());
        assert!(ws.style.is_none() && ws.library.is_empty());
        assert!(!ws.skills.iter().any(|s| s.name == "house"));
        assert_eq!(project_file(&project, "agent.md"), None);
        assert!(ws.levis_project, "offered for conversion instead");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_project_is_the_nearest_folder_above_with_a_textus_folder() {
        let root = scratch("walk-up");
        let novel = root.join("novel");
        write(&novel.join(".textus/agent.md"), "Novel rules.");
        write(&novel.join("part-1/scenes/one.md"), "# One");
        let doc = novel.join("part-1/scenes/one.md");
        assert_eq!(resolve_root(doc.to_str(), None), Some(novel.clone()));
        let ws = load_layers(None, doc.to_str(), None, &[]);
        assert_eq!(ws.root_source, RootSource::EnclosingProject);
        assert_eq!(ws.project_instructions.as_deref(), Some("Novel rules."));
        // A nearer .textus/ wins.
        write(&novel.join("part-1/.textus/agent.md"), "Part rules.");
        assert_eq!(resolve_root(doc.to_str(), None), Some(novel.join("part-1")));
        // With none anywhere above, the document's own folder, as before.
        let loose = root.join("loose/notes.md");
        write(&loose, "x");
        assert_eq!(resolve_root(loose.to_str(), None), Some(root.join("loose")));
        let ws = load_layers(None, loose.to_str(), None, &[]);
        assert_eq!(ws.root_source, RootSource::DocumentFolder);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_walk_up_never_takes_a_folder_too_broad() {
        let root = scratch("walk-stop");
        write(&root.join("a/b/c.md"), "x");
        assert_eq!(enclosing_project(&root.join("a/b")), None);
        assert_eq!(enclosing_project(Path::new("/")), None);
        // Even with a .textus/ in it, the home folder is no project.
        if let Some(home) = std::env::var_os("HOME") {
            assert_eq!(enclosing_project(Path::new(&home)), None);
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn textus_metadata_wins_over_the_levis_prefix() {
        let skill = parse_skill_file(
            "x",
            "---\nname: x\nmetadata:\n  levis-version: \"1\"\n  textus-version: \"2\"\n  levis-based-on: \"tighten@1\"\n  levis-aliases-en: \"old\"\n  textus-aliases-en: \"new\"\n---\nbody",
        );
        assert_eq!(skill.version.as_deref(), Some("2"));
        assert_eq!(skill.based_on.as_deref(), Some("tighten@1"));
        assert_eq!(skill.aliases["en"], ["new"]);
    }

    #[test]
    fn layers_override_built_ins_by_name() {
        let root = scratch("layers");
        let global = root.join("agent");
        let project = root.join("novel");
        write(
            &global.join("skills/tighten.md"),
            "---\nname: tighten\ndescription: Mine\n---\nCut hard.",
        );
        write(
            &global.join("skills/headline.md"),
            "---\nname: headline\ndescription: Global headline\n---\nGlobal.",
        );
        write(
            &project.join(".textus/skills/headline.md"),
            "---\nname: headline\ndescription: House style\n---\nAt most 6 words.",
        );
        write(&project.join("chapter.md"), "# One");
        let doc = project.join("chapter.md");
        let ws = load_layers(
            Some(&global),
            doc.to_str(),
            None,
            &["proofread".to_string(), "not-a-skill".to_string()],
        );
        let get = |name: &str| ws.skills.iter().find(|s| s.name == name).unwrap();
        assert_eq!(ws.skills.iter().filter(|s| s.name == "headline").count(), 1);
        let headline = get("headline");
        assert_eq!(headline.source, SkillSource::Project);
        assert!(headline.overrides_builtin && headline.prompt.contains("6 words"));
        let tighten = get("tighten");
        assert_eq!(tighten.source, SkillSource::Global);
        assert!(tighten.overrides_builtin && tighten.enabled);
        let proofread = get("proofread");
        assert_eq!(proofread.source, SkillSource::Builtin);
        assert!(!proofread.enabled, "turned off, still listed");
        assert!(get("email").enabled && get("email").source == SkillSource::Builtin);
        assert_eq!(ws.skills.len(), builtin::skills().len());
        assert!(
            !ws.skills.iter().any(|s| s.name.starts_with("standards")),
            "packs aren't skills"
        );
        // Disabling a built-in leaves a user override alone.
        let ws = load_layers(Some(&global), doc.to_str(), None, &["tighten".to_string()]);
        let tighten = ws.skills.iter().find(|s| s.name == "tighten").unwrap();
        assert!(tighten.enabled && tighten.source == SkillSource::Global);
        // ...but a copy made by Customize… follows the built-in's switch.
        customize_in(&global.join("skills"), "email").unwrap();
        let ws = load_layers(Some(&global), doc.to_str(), None, &["email".to_string()]);
        let email = ws.skills.iter().find(|s| s.name == "email").unwrap();
        assert!(email.based_on.is_some() && !email.enabled);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn customize_copies_and_reset_deletes_only_copies() {
        let root = scratch("customize");
        let skills = root.join("skills");
        let path = customize_in(&skills, "tighten").unwrap();
        assert_eq!(path, skills.join("tighten.md"));
        let copy = std::fs::read_to_string(&path).unwrap();
        assert!(copy.contains("textus-based-on: \"tighten@1\""));
        // The copy now shadows the built-in, marked as such.
        let ws = load_layers(Some(&root), None, None, &[]);
        let tighten = ws.skills.iter().find(|s| s.name == "tighten").unwrap();
        assert_eq!(tighten.source, SkillSource::Global);
        assert!(tighten.overrides_builtin && !tighten.builtin_updated);
        assert_eq!(tighten.based_on.as_deref(), Some("tighten@1"));
        // Customizing again never overwrites the user's edits.
        std::fs::write(&path, copy.replace("Cut words", "Cut WORDS")).unwrap();
        assert_eq!(customize_in(&skills, "tighten").unwrap(), path);
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("Cut WORDS"));
        // An older copy is flagged once the built-in moves on.
        std::fs::write(&path, copy.replace("tighten@1", "tighten@0")).unwrap();
        let ws = load_layers(Some(&root), None, None, &[]);
        assert!(
            ws.skills
                .iter()
                .find(|s| s.name == "tighten")
                .unwrap()
                .builtin_updated
        );
        // Reset deletes the copy, and says which file went (for the tab).
        assert_eq!(
            reset_in(&skills, "tighten").unwrap(),
            vec![path.to_string_lossy().to_string()]
        );
        assert!(!path.exists());
        assert!(reset_in(&skills, "tighten").unwrap().is_empty());
        // A hand-written skill of the same name is the user's own.
        write(
            &skills.join("mine.md"),
            "---\nname: email\n---\nMy email rules.",
        );
        assert_eq!(reset_in(&skills, "email").unwrap_err(), NOT_A_COPY);
        assert!(skills.join("mine.md").exists());
        assert_eq!(
            customize_in(&skills, "email").unwrap(),
            skills.join("mine.md")
        );
        // A file with the stem but another skill inside keeps its name.
        write(&skills.join("notice.md"), "---\nname: my-notice\n---\nx");
        assert_eq!(
            customize_in(&skills, "notice").unwrap(),
            skills.join("notice-2.md")
        );
        assert_eq!(customize_in(&skills, "nope").unwrap_err(), UNKNOWN_BUILTIN);
        assert_eq!(reset_in(&skills, "nope").unwrap_err(), UNKNOWN_BUILTIN);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn turning_built_ins_off_and_on() {
        let off = toggled_builtins(&[], "tighten", false);
        assert_eq!(off, ["tighten"]);
        let off = toggled_builtins(&off, "email", false);
        assert_eq!(off, ["email", "tighten"]);
        let off = toggled_builtins(&off, "email", false);
        assert_eq!(off, ["email", "tighten"], "no repeats");
        assert_eq!(toggled_builtins(&off, "tighten", true), ["email"]);
        assert_eq!(
            toggled_builtins(&["gone".to_string(), "email".to_string()], "email", true),
            Vec::<String>::new(),
            "names that are no longer built-ins drop out"
        );
    }

    #[test]
    fn skill_list_serialises_the_interface_the_frontend_reads() {
        let skill = builtin::find("continue-story").unwrap();
        let v = serde_json::to_value(skill).unwrap();
        assert_eq!(v["name"], "continue-story");
        assert_eq!(v["category"], "write");
        assert_eq!(v["invocation"], "both");
        assert_eq!(v["source"], "builtin");
        assert_eq!(v["overridesBuiltin"], false);
        assert_eq!(v["enabled"], true);
        assert_eq!(v["aliases"]["zh"][0], "接着写");
        assert_eq!(v["packs"][0], "contract");
        assert_eq!(v["version"], "1");
        assert!(v["basedOn"].is_null());
        assert_eq!(v["builtinUpdated"], false);
        assert!(v.get("targetPacks").is_none());
        let tighten = serde_json::to_value(builtin::find("tighten").unwrap()).unwrap();
        assert_eq!(tighten["invocation"], "userOnly");
    }

    #[test]
    fn skill_name_with_spaces_is_slugged() {
        // /name invocation can't contain spaces - collapse them so the
        // picker and use_skill lookups agree on one token.
        let skill = parse_skill_file("x", "---\nname: fix my prose\n---\nbody");
        assert_eq!(skill.name, "fix-my-prose");
    }

    #[test]
    fn the_skill_list_keeps_turned_off_built_ins_and_drops_hidden_ones() {
        let ws = load_layers(None, None, None, &["describe".to_string()]);
        let mut skills = ws.skills.clone();
        skills.push(AgentSkill {
            name: "secret".into(),
            invocation: Invocation::Hidden,
            ..Default::default()
        });
        let list = listed(skills);
        assert_eq!(list.len(), 19);
        let describe = list.iter().find(|s| s.name == "describe").unwrap();
        assert!(!describe.enabled && describe.source == SkillSource::Builtin);
        let json = serde_json::to_value(&list[0]).unwrap();
        assert!(json.get("overridesBuiltin").is_some() && json.get("invocation").is_some());
    }
}
