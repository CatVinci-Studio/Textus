//! Skill files: one parsed, a layer of them read (built in, global,
//! project), a customized copy made or reset, and the file names they are
//! saved under.

use super::*;

/// The prefix of the app's own keys under a skill's `metadata:`.
pub(crate) const META_PREFIX: &str = "textus";

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
        fm.metadata
            .get(&format!("{META_PREFIX}-{key}"))
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
    };
    if let Some(invocation) = meta("invocation") {
        skill.invocation = match invocation.to_ascii_lowercase().as_str() {
            "user-only" | "user_only" | "useronly" | "user" => Invocation::UserOnly,
            "hidden" => Invocation::Hidden,
            _ => Invocation::Both,
        };
    }
    skill.category = meta("category").map(str::to_string);
    for (key, value) in &fm.metadata {
        let Some(lang) = key
            .strip_prefix(META_PREFIX)
            .and_then(|k| k.strip_prefix("-label-"))
        else {
            continue;
        };
        let label = value.trim();
        if !label.is_empty() {
            skill.labels.insert(
                lang.to_string(),
                SkillLabel {
                    label: label.to_string(),
                    hint: meta(&format!("hint-{lang}")).unwrap_or("").to_string(),
                },
            );
        }
    }
    if let Some(modes) = meta("modes") {
        let mut list: Vec<AgentMode> = modes
            .split([' ', ','])
            .filter_map(AgentMode::from_word)
            .collect();
        list.sort();
        list.dedup();
        if !list.is_empty() {
            skill.modes = list;
        }
    }
    skill.off = meta("off") == Some("true");
    skill.version = meta("version").map(str::to_string);
    skill.based_on = meta("based-on").map(str::to_string);
    skill.index_line = meta("index").map(str::to_string);
    let words = |v: Option<&str>| {
        v.map(|v| v.split_whitespace().map(str::to_string).collect())
            .unwrap_or_default()
    };
    skill.packs = words(meta("packs"));
    skill.target_packs = words(meta("target-packs"));
    let alias_keys = fm.metadata.iter().filter_map(|(key, value)| {
        let lang = key.strip_prefix(META_PREFIX)?.strip_prefix("-aliases-")?;
        Some((lang, value))
    });
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
/// before it reaches a prompt. An unterminated comment swallows the rest, as
/// HTML would.
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

/// Reads one layer: its agent.md and every skill under skills/, marked as from
/// `source`. Missing files or folders are empty layers, never errors.
pub(crate) fn read_layer(dir: &Path, source: SkillSource) -> (Option<String>, Vec<AgentSkill>) {
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
pub(crate) fn read_skill_files(skills_dir: &Path) -> Vec<(PathBuf, AgentSkill)> {
    crate::frontmatter::md_files(skills_dir, true)
        .into_iter()
        .filter_map(|path| {
            let stem = path.file_stem().and_then(|s| s.to_str())?.to_string();
            let content = std::fs::read_to_string(&path).ok()?;
            let skill = parse_skill_file(&stem, &content);
            (!skill.prompt.is_empty()).then_some((path, skill))
        })
        .collect()
}

/// Notes on a user skill that it replaces the built-in of its name, and whether
/// that built-in has changed since the copy was made.
pub(crate) fn mark_override(skill: &mut AgentSkill) {
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
pub(crate) fn push_layer_skill(skills: &mut Vec<AgentSkill>, skill: AgentSkill) {
    skills.retain(|s| s.name != skill.name);
    skills.push(skill);
}

/// The settings.json field where older profiles listed the built-ins turned off,
/// read only to know which market skills to install.
pub(crate) const DISABLED_BUILTINS_KEY: &str = "disabledBuiltinSkills";

/// Windows refuses these as file names whatever the extension ("con.md").
pub(crate) const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file stem for a skill named `name`, which comes from whoever wrote the
/// file: `name: ../../x` must not become a path.
pub(crate) fn skill_file_stem(name: &str) -> String {
    safe_file_stem(name, "skill", 120)
}

/// A file stem from text someone else chose: letters, digits, `-` and `_` kept,
/// all else `-`, capped at `max_bytes` (filesystems count bytes, CJK takes 3).
/// `fallback` stands in for an empty stem, and is appended to a name Windows refuses.
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

/// Where the skill `name` is stored in `skills_dir`, checked to be a file
/// directly inside it as a second line of defence.
pub(crate) fn skill_file_path(skills_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = skills_dir.join(format!("{}.md", skill_file_stem(name)));
    if path.parent() != Some(skills_dir) {
        return Err(crate::errors::error("skillName"));
    }
    Ok(path)
}

/// What writing a new skill file does where its name's file is there.
pub(crate) enum OnTaken {
    /// Writes over it (an imported file of that name).
    Replace,
    /// Writes beside it as `name-2`, `name-3`… (a copy, an offer saved).
    NextFree,
    /// Leaves it and fails with the error `code` stands for.
    Refuse(&'static str),
}

/// Writes skill `name`'s file in `dir` (made if missing), in one step:
/// `text` is given the name the file gets.
pub(crate) fn write_skill_file(
    dir: &Path,
    name: &str,
    on_taken: OnTaken,
    text: impl FnOnce(&str) -> String,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut chosen = name.to_string();
    let mut path = skill_file_path(dir, name)?;
    match on_taken {
        OnTaken::Replace => {}
        OnTaken::Refuse(code) if path.exists() => return Err(crate::errors::error(code)),
        OnTaken::Refuse(_) => {}
        OnTaken::NextFree => {
            let mut n = 2;
            while path.exists() {
                chosen = format!("{name}-{n}");
                path = skill_file_path(dir, &chosen)?;
                n += 1;
            }
        }
    }
    crate::atomic::write_sync(&path, text(&chosen)).map_err(|e| e.to_string())?;
    Ok(path)
}

/// The built-in skill commands' errors, by code (errors.json).
pub(crate) const UNKNOWN_BUILTIN: &str = "unknownBuiltin";

pub(crate) const NOT_A_COPY: &str = "notACopy";

pub(crate) fn customize_in(skills_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let (Some(builtin), Some(raw)) = (builtin::find(name), builtin::raw(name)) else {
        return Err(crate::errors::error(UNKNOWN_BUILTIN));
    };
    if let Some((path, _)) = read_skill_files(skills_dir)
        .into_iter()
        .find(|(_, s)| s.name == builtin.name)
    {
        return Ok(path);
    }
    // A file of that stem holding some other skill keeps its name.
    let version = builtin.version.as_deref().unwrap_or("1");
    write_skill_file(skills_dir, &builtin.name, OnTaken::NextFree, |_| {
        builtin::with_based_on(raw, &format!("{}@{version}", builtin.name))
    })
}

pub(crate) fn reset_in(skills_dir: &Path, name: &str) -> Result<Vec<String>, String> {
    if builtin::find(name).is_none() {
        return Err(crate::errors::error(UNKNOWN_BUILTIN));
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
        return Err(crate::errors::error(NOT_A_COPY));
    }
    let mut deleted = Vec::new();
    for path in copies {
        // The user may have edited their copy: to the Trash.
        crate::atomic::to_trash(path)?;
        deleted.push(path.to_string_lossy().to_string());
    }
    Ok(deleted)
}

/// `raw` with its `metadata:` key `textus-<key>` set to `value`: replaced, or
/// added under `metadata:` at its keys' indent, adding that or the front
/// matter when missing. A file with no front matter keeps its file's name
/// (none is written), a leading BOM goes.
pub(crate) fn with_metadata(raw: &str, key: &str, value: &str) -> String {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let field = format!("{META_PREFIX}-{key}:");
    let entry = |indent: &str| format!("{indent}{field} \"{value}\"");
    let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
    let closing = crate::frontmatter::split(raw).map(|front| front.lines.len() + 1);
    let indent_of = |l: &str| l[..l.len() - l.trim_start().len()].to_string();
    match closing {
        Some(end) => {
            if let Some(i) = lines[..end]
                .iter()
                .position(|l| l.trim_start().starts_with(&field))
            {
                lines[i] = entry(&indent_of(&lines[i]));
            } else if let Some(i) = lines[..end]
                .iter()
                .position(|l| l.trim_end() == "metadata:")
            {
                // Beside the keys already there, at their indent.
                let indent = lines[i + 1..end]
                    .first()
                    .map(|l| indent_of(l))
                    .filter(|d| !d.is_empty())
                    .unwrap_or_else(|| "  ".into());
                lines.insert(i + 1, entry(&indent));
            } else {
                lines.insert(end, entry("  "));
                lines.insert(end, "metadata:".to_string());
            }
        }
        None => {
            let mut head = vec![
                "---".to_string(),
                "metadata:".to_string(),
                entry("  "),
                "---".to_string(),
            ];
            head.extend(lines);
            lines = head;
        }
    }
    let mut text = lines.join("\n");
    if raw.ends_with('\n') || closing.is_none() {
        text.push('\n');
    }
    text
}

/// The most a skill file written in a reply may be.
const MAX_WRITTEN_SKILL: usize = 64 * 1024;

/// Writes a skill file from a reply into `skills_dir` with `modes`: a new
/// file, or over the one holding the skill of that name already. A skill
/// with warnings (`skill_warnings`) is saved only once `confirmed`; until
/// then the error is `SKILL_NEEDS_CONFIRM:` and the warnings, `,`-joined.
pub(crate) fn save_written_in(
    skills_dir: &Path,
    text: &str,
    modes: &[AgentMode],
    confirmed: bool,
) -> Result<PathBuf, String> {
    if text.len() > MAX_WRITTEN_SKILL {
        return Err(crate::errors::error("skillTooLong"));
    }
    let skill = parse_skill_file("", text);
    if skill.name.is_empty() || skill.prompt.is_empty() {
        return Err(crate::errors::error("notSkill"));
    }
    if modes.is_empty() {
        return Err(crate::errors::error("skillNoMode"));
    }
    // The description is shown to the model too, in the list of skills.
    let read = format!("{}\n{}", skill.description, skill.prompt);
    let warnings = skill_warnings(&read, modes);
    if !confirmed && !warnings.is_empty() {
        return Err(format!("{SKILL_NEEDS_CONFIRM}:{}", warnings.join(",")));
    }
    std::fs::create_dir_all(skills_dir).map_err(|e| e.to_string())?;
    let path = match read_skill_files(skills_dir)
        .into_iter()
        .find(|(_, s)| s.name == skill.name)
    {
        Some((path, _)) => path,
        None => skill_file_path(skills_dir, &skill.name)?,
    };
    let words: Vec<String> = modes.iter().map(|m| m.to_string()).collect();
    crate::atomic::write_sync(&path, with_metadata(text, "modes", &words.join(" ")))
        .map_err(|e| e.to_string())?;
    Ok(path)
}

/// Rewrites the modes of the skill `name` in `skills_dir`.
pub(crate) fn set_modes_in(
    skills_dir: &Path,
    name: &str,
    modes: &[AgentMode],
) -> Result<(), String> {
    let mut modes = modes.to_vec();
    modes.sort();
    modes.dedup();
    if modes.is_empty() {
        return Err(crate::errors::error("skillNoMode"));
    }
    let (path, _) = read_skill_files(skills_dir)
        .into_iter()
        .find(|(_, s)| s.name == name)
        .ok_or_else(|| format!("No skill called {name}."))?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let words: Vec<String> = modes.iter().map(|m| m.to_string()).collect();
    let text = with_metadata(&raw, "modes", &words.join(" "));
    crate::atomic::write_sync(&path, text).map_err(|e| e.to_string())
}

/// The files of the user's skill `name` in `skills_dir`, for Delete: every
/// file of that name, as a stray second copy would come back otherwise.
pub(crate) fn skill_files_named(skills_dir: &Path, name: &str) -> Result<Vec<PathBuf>, String> {
    let files: Vec<PathBuf> = read_skill_files(skills_dir)
        .into_iter()
        .filter(|(_, s)| s.name == name)
        .map(|(p, _)| p)
        .collect();
    if files.is_empty() {
        return Err(format!("No skill called {name}."));
    }
    Ok(files)
}

/// Turns the skill `name` in `skills_dir` off, or on again.
pub(crate) fn set_off_in(skills_dir: &Path, name: &str, off: bool) -> Result<(), String> {
    let (path, _) = read_skill_files(skills_dir)
        .into_iter()
        .find(|(_, s)| s.name == name)
        .ok_or_else(|| format!("No skill called {name}."))?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let text = with_metadata(&raw, "off", if off { "true" } else { "false" });
    crate::atomic::write_sync(&path, text).map_err(|e| e.to_string())
}
