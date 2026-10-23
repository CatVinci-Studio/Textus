//! Skill files: one parsed, a layer of them read (built in, global,
//! project), a customized copy made or reset, and the file names they are
//! saved under.

use super::*;

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
/// read). Claude Code's top-level `disable-model-invocation: true` also makes a
/// skill /name-only.
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
    skill.version = meta("version").map(str::to_string);
    skill.based_on = meta("based-on").map(str::to_string);
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

/// The built-in skills the user turned off in Settings > Textus AI > Skills
/// (settings.json's `disabledBuiltinSkills`).
pub(crate) fn disabled_builtin_skills(app: &AppHandle) -> Vec<String> {
    crate::settings::read_setting(app, DISABLED_BUILTINS_KEY)
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

/// The settings.json field listing the built-in skills turned off.
pub(crate) const DISABLED_BUILTINS_KEY: &str = "disabledBuiltinSkills";

/// Windows refuses these as file names whatever the extension ("con.md").
pub(crate) const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file stem for a skill named `name`. The name comes from the imported
/// file's frontmatter, i.e. from whoever wrote that file: `name: ../../x`
/// must not become a path - see safe_file_stem.
pub(crate) fn skill_file_stem(name: &str) -> String {
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
pub(crate) fn skill_file_path(skills_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = skills_dir.join(format!("{}.md", skill_file_stem(name)));
    if path.parent() != Some(skills_dir) {
        return Err("That skill's name can't be used as a file name.".to_string());
    }
    Ok(path)
}

/// Errors the built-in skill commands return, for the frontend to map to
/// its own messages.
pub(crate) const UNKNOWN_BUILTIN: &str = "UNKNOWN_BUILTIN";

pub(crate) const NOT_A_COPY: &str = "NOT_A_COPY";

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

/// The disabled list after turning `name` on or off: sorted, no repeats,
/// and only names that are still built-in skills.
pub(crate) fn toggled_builtins(current: &[String], name: &str, enabled: bool) -> Vec<String> {
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
