//! The memory commands: the pass after an exchange, a skill offered, and
//! what the Memory tab does - restore, undo, move, delete, remember - plus
//! the revision choices kept beside memory.

use super::*;

/// memory_pass's inputs, the keys of `ai.memoryPass`'s invoke.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PassRequest {
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    conversation: Option<Source>,
    exchange: Exchange,
}

/// After each exchange: what to remember, update or forget, decided by the
/// conversation's own model, each change for a chip under the reply. Nothing
/// while Remember automatically is off.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_pass(
    app: tauri::AppHandle,
    request: PassRequest,
) -> Result<Vec<Remembering>, String> {
    let PassRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        conversation,
        exchange,
    } = request;
    crate::ai::ensure_on(&app)?;
    if !remember_enabled(&app) {
        return Ok(Vec::new());
    }
    let dirs = MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref());
    let source = Source {
        document: doc_path,
        ..conversation.unwrap_or_default()
    };
    let call = |instructions, input| async {
        crate::ai::client::call(&app, &provider, instructions, input, model.as_deref()).await
    };
    let mut made = run_pass(&dirs, &exchange, &source, call).await?;
    // Now and then, the whole memory tidied. Its failing takes nothing from the
    // exchange's own changes.
    made.extend(tidy_if_due(&dirs, &source, call).await.unwrap_or_default());
    Ok(made)
}

/// ai_offer_skill's inputs, as memory_pass's.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OfferRequest {
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    exchange: Exchange,
}

/// After an exchange: its request offered as a skill to save, when it was a
/// procedure of its own.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_offer_skill(
    app: tauri::AppHandle,
    request: OfferRequest,
) -> Result<Option<SkillOffer>, String> {
    let OfferRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        exchange,
    } = request;
    crate::ai::ensure_on(&app)?;
    if !may_offer(&exchange) {
        return Ok(None);
    }
    let skills =
        crate::ai::workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref()).skills;
    offer_skill(&exchange, &skills, |instructions, input| async {
        crate::ai::client::call(&app, &provider, instructions, input, model.as_deref()).await
    })
    .await
}

/// The offered skill saved, for every document or this project's. Returns
/// its file's path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_offered_skill(
    app: tauri::AppHandle,
    offer: SkillOffer,
    // "personal" or "project".
    scope: String,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    // The panel modes it is to apply in.
    modes: Vec<crate::ai::agent::AgentMode>,
    // The warnings it was saved with were shown and saved through.
    confirmed: bool,
) -> Result<String, String> {
    let source = match Scope::parse(&scope).ok_or("Unknown scope.")? {
        Scope::Personal => crate::ai::workspace::SkillSource::Global,
        Scope::Project => crate::ai::workspace::SkillSource::Project,
    };
    let dir = crate::ai::workspace::skills_dir(
        &app,
        source,
        doc_path.as_deref(),
        workspace_root.as_deref(),
    )?;
    tauri::async_runtime::spawn_blocking(move || save_offer_in(&dir, &offer, &modes, confirmed))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

/// Restore in the Memory tab's Recently forgotten: puts a forgotten memory
/// or library entry back. Returns its id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_restore(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref()).restore(&id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The chat chip's Undo: deletes what a remember call created, or writes
/// back `previous`, the file before it was updated.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_undo(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    previous: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref())
            .undo(&id, previous.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Make personal" / "Make project", in the chat chip and the Memory tab.
/// Returns the memory's new id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_move(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    scope: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = Scope::parse(&scope).ok_or("Unknown scope.")?;
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref())
            .move_to(&id, scope)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Memory tab's Delete, for a memory or a library entry.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_delete(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref()).delete(&id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Remember" on a suggestion learned from revision choices: one memory
/// written as the pass writes one. A click, not the model, so it saves even
/// while Remember automatically is off.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_remember(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    kind: String,
    scope: String,
    text: String,
) -> Result<Remembering, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref());
        let source = Source {
            document: doc_path,
            ..Source::default()
        };
        dirs.keep(&kind, &scope, &text, &source)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn revision_choices_read(app: tauri::AppHandle) -> Option<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, None, None).read_choices()
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn revision_choices_write(
    app: tauri::AppHandle,
    log: serde_json::Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, None, None).write_choices(&log)
    })
    .await
    .map_err(|e| e.to_string())?
}
