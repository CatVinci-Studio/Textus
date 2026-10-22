//! The memory folders on disk: what is remembered read and written,
//! found again by its id, updated in place or moved between scopes, and
//! the writer's revision choices kept beside it.

use super::*;

impl MemoryDirs {
    /// `global_dir`: the global config folder; `root`: the project folder.
    pub fn new(global_dir: Option<&Path>, root: Option<&Path>) -> Self {
        Self {
            personal: global_dir.map(Path::to_path_buf),
            project: root.map(Path::to_path_buf),
        }
    }

    /// The memory folders of a document, as the commands resolve them.
    pub fn for_document(
        app: &tauri::AppHandle,
        doc_path: Option<&str>,
        workspace_root: Option<&str>,
    ) -> Self {
        Self {
            personal: global_agent_dir(app).ok(),
            project: project_root(doc_path, workspace_root),
        }
    }

    /// The folder for `scope`'s memories or library; the library is the
    /// project's only.
    pub(crate) fn folder(&self, scope: Scope, folder: &str) -> Option<PathBuf> {
        match (scope, folder) {
            (Scope::Personal, MEMORY_FOLDER) => Some(self.personal.as_ref()?.join(MEMORY_FOLDER)),
            (Scope::Project, MEMORY_FOLDER | LIBRARY_FOLDER) => {
                Some(project_dir(self.project.as_ref()?).join(folder))
            }
            _ => None,
        }
    }

    /// The file an id names - only ever a `.md` file directly inside one
    /// of the memory folders or the project's library, and never a link.
    pub(crate) fn locate(&self, id: &str) -> Result<Located, String> {
        let unknown = || format!("No memory `{id}`.");
        let mut parts = id.trim().splitn(3, '/');
        let scope = parts.next().and_then(Scope::parse).ok_or_else(unknown)?;
        let folder = match parts.next() {
            Some(MEMORY_FOLDER) => MEMORY_FOLDER,
            Some(LIBRARY_FOLDER) => LIBRARY_FOLDER,
            _ => return Err(unknown()),
        };
        let stem = parts.next().unwrap_or_default();
        if stem.is_empty()
            || stem.starts_with('.')
            || stem.contains(['/', '\\'])
            || stem.chars().any(char::is_control)
        {
            return Err(unknown());
        }
        let dir = self.folder(scope, folder).ok_or_else(unknown)?;
        let path = dir.join(format!("{stem}.md"));
        if path.parent() != Some(dir.as_path()) {
            return Err(unknown());
        }
        if let Ok(meta) = std::fs::symlink_metadata(&path) {
            if !meta.file_type().is_file() {
                return Err(unknown());
            }
        }
        Ok(Located {
            scope,
            folder,
            path,
        })
    }

    /// Every memory, personal first, with MAX_MEMORY_CHARS spent on the
    /// project's newest first (they win a conflict), then the personal
    /// ones' newest first.
    pub fn load(&self) -> Memories {
        let mut items = self.read(Scope::Personal);
        items.extend(self.read(Scope::Project));
        let mut order: Vec<usize> = (0..items.len()).collect();
        order.sort_by(|&a, &b| {
            let rank = |m: &Memory| (m.scope == Scope::Personal) as u8;
            rank(&items[a]).cmp(&rank(&items[b])).then_with(|| {
                items[b]
                    .remembered
                    .updated
                    .cmp(&items[a].remembered.updated)
            })
        });
        let mut chars = 0;
        for i in order {
            let size = items[i].text.chars().count();
            if chars + size <= MAX_MEMORY_CHARS {
                chars += size;
                items[i].included = true;
            }
        }
        Memories {
            items,
            chars,
            cap: MAX_MEMORY_CHARS,
        }
    }

    /// One scope's memories, newest first.
    pub(crate) fn read(&self, scope: Scope) -> Vec<Memory> {
        let Some(dir) = self.folder(scope, MEMORY_FOLDER) else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut items: Vec<Memory> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
            .filter_map(|path| {
                let stem = path.file_stem()?.to_str()?.to_string();
                let content = std::fs::read_to_string(&path).ok()?;
                let (front, body) = split_frontmatter(&content);
                let fields = front.map(|f| f.fields).unwrap_or_default();
                let text = strip_html_comments(&body).trim().to_string();
                (!text.is_empty()).then(|| Memory {
                    id: format!("{}/{MEMORY_FOLDER}/{stem}", scope.as_str()),
                    scope,
                    kind: fields
                        .get("kind")
                        .and_then(|k| MemoryKind::parse(k))
                        .unwrap_or(MemoryKind::Preference),
                    text,
                    file: path.to_string_lossy().into_owned(),
                    remembered: Remembered::from_fields(&fields),
                    included: false,
                })
            })
            .collect();
        items.sort_by(|a, b| {
            b.remembered
                .updated
                .cmp(&a.remembered.updated)
                .then_with(|| a.id.cmp(&b.id))
        });
        items
    }

    /// The remember tool: validates, refuses a duplicate, and writes one
    /// memory (or library entry) through the atomic writer. The error is
    /// what the model is told instead.
    pub(crate) fn remember(
        &self,
        args: RememberArgs,
        source: &Source,
        now: &str,
    ) -> Result<Remembering, String> {
        let text = args.text.trim();
        if text.is_empty() {
            return Err("`text` is required: the memory itself, in one or a few sentences.".into());
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(format!("That is too long for a memory ({} characters): keep it to one or a few sentences, at most {MAX_TEXT_CHARS} characters.", text.chars().count()));
        }
        if args.kind.trim() == "fact" {
            return self.remember_fact(&args, text, source, now);
        }
        let kind = MemoryKind::parse(&args.kind)
            .ok_or("`kind` must be requirement, preference, style or fact.")?;
        let replaced = args
            .replaces
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| self.locate(id).map(|loc| (id, loc)))
            .transpose()?;
        if let Some((id, loc)) = &replaced {
            if loc.folder != MEMORY_FOLDER || !loc.path.is_file() {
                return Err(format!("No memory `{id}` to replace - use an id listed under what you remember, or leave `replaces` out."));
            }
        }
        let key = normalized(text);
        if let Some(same) = self
            .load()
            .items
            .into_iter()
            .find(|m| normalized(&m.text) == key)
        {
            return Err(format!(
                "Already remembered as `{}` - nothing saved.",
                same.id
            ));
        }
        let (scope, path, previous, mut record) = match replaced {
            Some((_, loc)) => {
                let previous = std::fs::read_to_string(&loc.path).map_err(|e| e.to_string())?;
                let (front, _) = split_frontmatter(&previous);
                let record = Remembered::from_fields(&front.map(|f| f.fields).unwrap_or_default());
                (loc.scope, loc.path, Some(previous), record)
            }
            None => {
                // The scope rule (also in the prompt): without a project,
                // everything is personal.
                let scope = match args.scope.as_deref().and_then(Scope::parse) {
                    Some(Scope::Project) | None if self.project.is_some() => Scope::Project,
                    _ => Scope::Personal,
                };
                let dir = self
                    .folder(scope, MEMORY_FOLDER)
                    .ok_or("Nowhere to keep memories: the app's config folder isn't available.")?;
                let path = free_path(&dir, &memory_stem(text));
                (scope, path, None, Remembered::default())
            }
        };
        if record.created.is_empty() {
            record.created = now.to_string();
        }
        record.updated = now.to_string();
        record.conversation = source.conversation.clone();
        record.title = source.title.clone();
        record.document = source.document.clone();
        let content = format!(
            "---\nkind: {}\n{}---\n{text}\n",
            kind.as_str(),
            record.lines()
        );
        write(&path, &content)?;
        Ok(Remembering {
            remembered: id_of(scope, MEMORY_FOLDER, &path),
            scope,
            created: previous.is_none(),
            text: text.to_string(),
            previous,
            note: SAVED_NOTE,
        })
    }

    /// A fact about the work: a library entry (`name`, `aliases`), new or
    /// one Textus AI wrote before - never one the user wrote.
    pub(crate) fn remember_fact(
        &self,
        args: &RememberArgs,
        text: &str,
        source: &Source,
        now: &str,
    ) -> Result<Remembering, String> {
        let (Some(root), Some(dir)) = (&self.project, self.folder(Scope::Project, LIBRARY_FOLDER))
        else {
            return Err("There is no project folder (the document isn't saved, or its folder is too broad), so there is no library to keep facts about the work in. Don't remember it; if it matters, tell the user that saving the document lets you.".into());
        };
        let name = one_line(args.name.as_deref().unwrap_or_default());
        if name.is_empty() {
            return Err(
                "`name` is required for a fact: the person, place or term it is about.".into(),
            );
        }
        let aliases: Vec<String> = args
            .aliases
            .iter()
            .map(|a| {
                one_line(a)
                    .replace([',', '，', '、', '[', ']'], " ")
                    .trim()
                    .to_string()
            })
            .filter(|a| a.to_lowercase() != name.to_lowercase() && !too_short_an_alias(a))
            .collect();
        let library = read_library(root);
        let stem_of = |entry: &LibraryEntry| {
            Path::new(&entry.file)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let existing = match args
            .replaces
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => {
                let loc = self.locate(id)?;
                let entry = library
                    .iter()
                    .find(|e| loc.folder == LIBRARY_FOLDER && stem_of(e) == file_stem(&loc.path))
                    .ok_or_else(|| format!("No library entry `{id}` to replace."))?;
                Some(entry)
            }
            None => library.iter().find(|e| {
                std::iter::once(&e.name)
                    .chain(e.aliases.iter())
                    .any(|n| n.to_lowercase() == name.to_lowercase())
            }),
        };
        if let Some(entry) = existing {
            let id = format!("project/{LIBRARY_FOLDER}/{}", stem_of(entry));
            if entry.remembered.is_none() {
                return Err(format!("The library's entry for {} (`{id}`) is the user's own, and you never change it: tell the user what to add to it instead.", entry.name));
            }
            if normalized(&entry.body) == normalized(text) && entry.name == name {
                return Err(format!("Already remembered as `{id}` - nothing saved."));
            }
        }
        let (path, previous, mut record) = match existing {
            Some(entry) => {
                let path = dir.join(format!("{}.md", stem_of(entry)));
                let previous = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                (
                    path,
                    Some(previous),
                    entry.remembered.clone().unwrap_or_default(),
                )
            }
            None => (
                free_path(&dir, &safe_file_stem(&name, "entry", 80)),
                None,
                Remembered::default(),
            ),
        };
        if record.created.is_empty() {
            record.created = now.to_string();
        }
        record.updated = now.to_string();
        record.conversation = source.conversation.clone();
        record.title = source.title.clone();
        record.document = source.document.clone();
        let content = format!(
            "---\nname: {name}\naliases: [{}]\n{}---\n{text}\n",
            aliases.join(", "),
            record.lines()
        );
        write(&path, &content)?;
        Ok(Remembering {
            remembered: id_of(Scope::Project, LIBRARY_FOLDER, &path),
            scope: Scope::Project,
            created: previous.is_none(),
            text: text.to_string(),
            previous,
            note: SAVED_NOTE,
        })
    }

    /// Undo of a remember call: deletes what it created, or puts back the
    /// file as it was before it updated it. Only ever touches what Textus
    /// AI wrote.
    pub fn undo(&self, id: &str, previous: Option<&str>) -> Result<(), String> {
        let loc = self.locate(id)?;
        let ours =
            |content: &str| loc.folder == MEMORY_FOLDER || Remembered::from_file(content).is_some();
        match previous {
            None => {
                let current = std::fs::read_to_string(&loc.path).map_err(|_| "GONE".to_string())?;
                if !ours(&current) {
                    return Err("NOT_REMEMBERED".into());
                }
                std::fs::remove_file(&loc.path).map_err(|e| e.to_string())
            }
            Some(previous) => {
                if !ours(previous) {
                    return Err("NOT_REMEMBERED".into());
                }
                write(&loc.path, previous)
            }
        }
    }

    /// Moves a memory to the other scope - its file to the other folder.
    /// Returns its new id.
    pub fn move_to(&self, id: &str, scope: Scope) -> Result<String, String> {
        let loc = self.locate(id)?;
        if loc.folder != MEMORY_FOLDER {
            return Err("Only memories move between personal and project.".into());
        }
        if loc.scope == scope {
            return Ok(id.to_string());
        }
        let dir = self.folder(scope, MEMORY_FOLDER).ok_or("NO_PROJECT")?;
        let content = std::fs::read_to_string(&loc.path).map_err(|_| "GONE".to_string())?;
        let target = free_path(&dir, &file_stem(&loc.path));
        write(&target, &content)?;
        std::fs::remove_file(&loc.path).map_err(|e| e.to_string())?;
        Ok(id_of(scope, MEMORY_FOLDER, &target))
    }

    /// Deletes a memory or a library entry (the Memory tab asks first).
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let loc = self.locate(id)?;
        match std::fs::remove_file(&loc.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

// --------------------------------------------------------- revision choices

impl MemoryDirs {
    pub(crate) fn choices_file(&self) -> Option<PathBuf> {
        self.folder(Scope::Personal, MEMORY_FOLDER)
            .map(|dir| dir.join(CHOICES_FILE))
    }

    /// The log, or None when there is none yet or it can't be read.
    pub(crate) fn read_choices(&self) -> Option<serde_json::Value> {
        let text = std::fs::read_to_string(self.choices_file()?).ok()?;
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .filter(serde_json::Value::is_object)
    }

    pub(crate) fn write_choices(&self, log: &serde_json::Value) -> Result<(), String> {
        if !log.is_object() {
            return Err("Not a revision choices log.".into());
        }
        let text = serde_json::to_string(log).map_err(|e| e.to_string())?;
        if text.len() > MAX_CHOICES_BYTES {
            return Err("The revision choices log is too large.".into());
        }
        let path = self
            .choices_file()
            .ok_or("Nowhere to keep it: the app's config folder isn't available.")?;
        write(&path, &text)
    }
}
