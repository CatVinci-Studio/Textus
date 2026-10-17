use super::{
    image,
    provider::{self, MediaError},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        LazyLock, Mutex,
    },
};
use tauri::{AppHandle, Manager};

/// Supplied by the UI, outside model-controlled tool arguments. Mirrors ipc.ts.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTaskPermission {
    pub task_id: String,
    pub document_id: String,
    pub base_revision: u64,
    pub allow_automatic: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRequest {
    pub prompt: String,
    pub anchor: String,
    pub alt: String,
    pub caption: Option<String>,
    pub size: Option<String>,
    pub quality: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageJob {
    pub job_id: String,
    pub task_id: String,
    pub document_id: String,
    pub base_revision: u64,
    pub sequence: usize,
    pub request: ImageRequest,
    pub status: String,
    pub preview_path: Option<String>,
    pub error: Option<String>,
    pub model: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub asset_src: Option<String>,
    #[serde(skip)]
    prepared_path: Option<String>,
}

#[derive(Default)]
struct Registry {
    jobs: HashMap<String, ImageJob>,
    counts: HashMap<String, usize>,
}
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));
static LANE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static RECOVERED: AtomicBool = AtomicBool::new(false);
static RECOVERY_LOCK: Mutex<()> = Mutex::new(());

pub struct ImageTaskContext {
    pub app: AppHandle,
    pub permission: ImageTaskPermission,
    pub mode: String,
}
impl ImageTaskContext {
    pub fn allowed(&self) -> bool {
        self.permission.allow_automatic && matches!(self.mode.as_str(), "create" | "edit")
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}
fn reserve(
    counts: &mut HashMap<String, usize>,
    permission: &ImageTaskPermission,
) -> Result<usize, MediaError> {
    if !permission.allow_automatic
        || !valid_id(&permission.task_id)
        || !valid_id(&permission.document_id)
    {
        return Err(MediaError::new(
            "permission",
            "Image generation is not authorized for this task",
        ));
    }
    let key = format!("{}/{}", permission.document_id, permission.task_id);
    let count = counts.entry(key).or_default();
    if *count >= 2 {
        return Err(MediaError::new(
            "limit",
            "This task has reached its two image-request limit",
        ));
    }
    *count += 1;
    Ok(*count)
}
fn directory(app: &AppHandle) -> Result<PathBuf, MediaError> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("media-jobs"))
        .map_err(|_| MediaError::new("storage", "Cannot locate image job directory"))
}
async fn write_metadata(app: &AppHandle, job: &ImageJob) -> Result<(), MediaError> {
    let dir = directory(app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|_| MediaError::new("storage", "Cannot create image job directory"))?;
    let raw = serde_json::to_vec(job)
        .map_err(|_| MediaError::new("storage", "Cannot serialize image job"))?;
    crate::atomic::write(&dir.join(format!("{}.json", job.job_id)), raw)
        .await
        .map_err(|_| MediaError::new("storage", "Cannot save image job metadata"))
}
fn get_job(id: &str) -> Result<ImageJob, MediaError> {
    REGISTRY
        .lock()
        .unwrap()
        .jobs
        .get(id)
        .cloned()
        .ok_or_else(|| MediaError::new("not_found", "Image job no longer exists"))
}
fn store(job: ImageJob) {
    REGISTRY
        .lock()
        .unwrap()
        .jobs
        .insert(job.job_id.clone(), job);
}

/// Returns immediately. The synchronous Agent tool can enqueue without
/// holding up text generation; only the background job waits on the network.
pub fn start_job(
    context: &ImageTaskContext,
    request: ImageRequest,
) -> Result<ImageJob, MediaError> {
    if !context.allowed() {
        return Err(MediaError::new(
            "permission",
            "Ask/Plan cannot generate images; enable image generation for this task",
        ));
    }
    if request.anchor.trim().is_empty()
        || request.anchor.len() > 12000
        || request.prompt.trim().is_empty()
        || request.prompt.chars().count() > 12000
        || request.alt.len() > 2000
        || request.caption.as_ref().is_some_and(|c| c.len() > 4000)
    {
        return Err(MediaError::new(
            "invalid_request",
            "Specify a prompt, a stable section quote, and concise alternative text",
        ));
    }
    // Check configuration before consuming a task's request allowance.
    let _configured = provider::request(&context.app, "image", "images/generations")?;
    recover_registry(&context.app)?;
    let sequence = reserve(&mut REGISTRY.lock().unwrap().counts, &context.permission)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let job_id = format!(
        "image-{timestamp}-{}",
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let job = ImageJob {
        job_id: job_id.clone(),
        task_id: context.permission.task_id.clone(),
        document_id: context.permission.document_id.clone(),
        base_revision: context.permission.base_revision,
        sequence,
        request,
        status: "queued".into(),
        preview_path: None,
        error: None,
        model: None,
        width: None,
        height: None,
        asset_src: None,
        prepared_path: None,
    };
    store(job.clone());
    let app = context.app.clone();
    tauri::async_runtime::spawn(async move {
        run_job(app, job_id).await;
    });
    Ok(job)
}

async fn run_job(app: AppHandle, id: String) {
    let Ok(job) = get_job(&id) else {
        return;
    };
    let result = async {
        write_metadata(&app, &job).await?;
        let generated = provider::cancellable(&id, 180, async {
            let _permit = LANE
                .acquire()
                .await
                .map_err(|_| MediaError::new("cancelled", "Image queue stopped"))?;
            let mut running = get_job(&id)?;
            if running.status == "cancelled" {
                return Err(MediaError::new("cancelled", "Image job cancelled"));
            }
            running.status = "running".into();
            store(running);
            image::generate(
                &app,
                &job.request.prompt,
                job.request.size.as_deref().unwrap_or("1024x1024"),
                job.request.quality.as_deref(),
            )
            .await
        })
        .await?;
        if get_job(&id)?.status == "cancelled" {
            return Err(MediaError::new("cancelled", "Image job cancelled"));
        }
        let path = directory(&app)?.join(format!("{id}.{}", generated.ext));
        {
            let mut registry = REGISTRY.lock().unwrap();
            let writing = registry.jobs.get_mut(&id).unwrap();
            if writing.status == "cancelled" {
                return Err(MediaError::new("cancelled", "Image job cancelled"));
            }
            writing.preview_path = Some(path.to_string_lossy().into_owned());
        }
        crate::atomic::write(&path, generated.bytes)
            .await
            .map_err(|_| MediaError::new("storage", "Cannot save generated image"))?;
        if get_job(&id)?.status == "cancelled" {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(MediaError::new("cancelled", "Image job cancelled"));
        }
        let mut ready = get_job(&id)?;
        ready.status = "ready".into();
        ready.preview_path = Some(path.to_string_lossy().into_owned());
        ready.model = Some(generated.model);
        ready.width = Some(generated.width);
        ready.height = Some(generated.height);
        write_metadata(&app, &ready).await?;
        // Cancellation may have arrived during the atomic metadata write.
        if get_job(&id)?.status == "cancelled" {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(MediaError::new("cancelled", "Image job cancelled"));
        }
        store(ready);
        Ok::<(), MediaError>(())
    }
    .await;
    if let Err(error) = result {
        if let Ok(mut failed) = get_job(&id) {
            failed.status = if error.code == "cancelled" || failed.status == "cancelled" {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            failed.error = Some(error.message);
            if let Some(path) = failed.preview_path.take() {
                let _ = tokio::fs::remove_file(path).await;
            }
            store(failed.clone());
            let _ = write_metadata(&app, &failed).await;
        }
    }
}

#[tauri::command]
pub async fn media_start_image(
    app: AppHandle,
    permission: ImageTaskPermission,
    request: ImageRequest,
) -> Result<ImageJob, MediaError> {
    start_job(
        &ImageTaskContext {
            app,
            permission,
            mode: "edit".into(),
        },
        request,
    )
}

fn recover_registry(app: &AppHandle) -> Result<(), MediaError> {
    if RECOVERED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let _guard = RECOVERY_LOCK.lock().unwrap();
    if RECOVERED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let dir = directory(app)?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json")
                || std::fs::metadata(&path)
                    .map(|m| m.len() > 65536)
                    .unwrap_or(true)
            {
                continue;
            }
            let Some(mut job) = std::fs::read(&path)
                .ok()
                .and_then(|r| serde_json::from_slice::<ImageJob>(&r).ok())
            else {
                continue;
            };
            if !valid_id(&job.job_id)
                || !valid_id(&job.task_id)
                || !valid_id(&job.document_id)
                || path.file_stem().and_then(|s| s.to_str()) != Some(job.job_id.as_str())
            {
                continue;
            }
            if let Some(preview) = job.preview_path.as_ref() {
                let preview = PathBuf::from(preview);
                if preview.parent() != Some(dir.as_path())
                    || preview.file_stem().and_then(|s| s.to_str()) != Some(job.job_id.as_str())
                    || !matches!(
                        preview.extension().and_then(|s| s.to_str()),
                        Some("png" | "jpg" | "webp")
                    )
                {
                    continue;
                }
            }
            job.prepared_path = None;
            if matches!(job.status.as_str(), "prepared" | "preparing") {
                job.status = "failed".into();
                job.error = Some(
                    "Image insertion was interrupted. Verify the document before retrying.".into(),
                );
            }
            if matches!(job.status.as_str(), "queued" | "running") {
                job.status = "failed".into();
                job.error = Some("Image generation was interrupted. Retry explicitly.".into());
            }
            if job.status == "ready"
                && job
                    .preview_path
                    .as_ref()
                    .is_none_or(|p| !std::path::Path::new(p).is_file())
            {
                job.status = "failed".into();
                job.error =
                    Some("Generated image is no longer available. Retry explicitly.".into());
            }
            let mut registry = REGISTRY.lock().unwrap();
            if !registry.jobs.contains_key(&job.job_id) {
                let key = format!("{}/{}", job.document_id, job.task_id);
                let count = registry.counts.entry(key).or_default();
                *count = (*count).max(job.sequence);
                registry.jobs.insert(job.job_id.clone(), job);
            }
        }
    }
    RECOVERED.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn media_image_jobs(
    app: AppHandle,
    document_id: String,
) -> Result<Vec<ImageJob>, MediaError> {
    if !valid_id(&document_id) {
        return Err(MediaError::new(
            "invalid_request",
            "Invalid document identity",
        ));
    }
    recover_registry(&app)?;
    let mut jobs: Vec<_> = REGISTRY
        .lock()
        .unwrap()
        .jobs
        .values()
        .filter(|j| j.document_id == document_id)
        .cloned()
        .collect();
    jobs.sort_by(|a, b| a.task_id.cmp(&b.task_id).then(a.sequence.cmp(&b.sequence)));
    Ok(jobs)
}

#[tauri::command]
pub async fn media_cancel_image(app: AppHandle, job_id: String) -> Result<(), MediaError> {
    let mut job = get_job(&job_id)?;
    if matches!(job.status.as_str(), "committed" | "prepared" | "preparing") {
        return Err(MediaError::new(
            "conflict",
            "A committed or committing image cannot be cancelled",
        ));
    }
    job.status = "cancelled".into();
    store(job.clone());
    provider::media_cancel(job_id.clone());
    if let Some(ref path) = job.preview_path {
        let _ = tokio::fs::remove_file(path).await;
    }
    job.preview_path = None;
    store(job.clone());
    write_metadata(&app, &job).await?;
    Ok(())
}

#[tauri::command]
pub async fn media_prepare_image(
    app: AppHandle,
    job_id: String,
    doc_path: Option<String>,
) -> Result<String, MediaError> {
    use base64::Engine;
    let mut job = {
        let mut registry = REGISTRY.lock().unwrap();
        let job = registry
            .jobs
            .get_mut(&job_id)
            .ok_or_else(|| MediaError::new("not_found", "Image job no longer exists"))?;
        if job.status != "ready" {
            return Err(MediaError::new(
                "conflict",
                "This image is not ready to insert",
            ));
        }
        job.status = "preparing".into();
        job.clone()
    };
    let result = async {
        let path = job
            .preview_path
            .as_ref()
            .ok_or_else(|| MediaError::new("storage", "Image preview is missing"))?;
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|_| MediaError::new("storage", "Image preview no longer exists"))?;
        let (ext, _, _) = image::validate_image(&bytes)?;
        let saved = crate::commands::fs::save_pasted_image(
            app.clone(),
            doc_path.clone(),
            base64::engine::general_purpose::STANDARD.encode(bytes),
            ext.into(),
        )
        .await
        .map_err(|_| MediaError::new("storage", "Cannot save image through document assets"))?;
        let path = if std::path::Path::new(&saved.src).is_absolute() {
            PathBuf::from(&saved.src)
        } else {
            PathBuf::from(doc_path.as_ref().unwrap())
                .parent()
                .unwrap()
                .join(&saved.src)
        };
        job.asset_src = Some(saved.src.clone());
        job.prepared_path = Some(path.to_string_lossy().into_owned());
        job.status = "prepared".into();
        if let Err(error) = write_metadata(&app, &job).await {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error);
        }
        store(job.clone());
        Ok(saved.src)
    }
    .await;
    if result.is_err() {
        job.status = "ready".into();
        store(job);
    }
    result
}

#[tauri::command]
pub async fn media_finish_image(
    app: AppHandle,
    job_id: String,
    accepted: bool,
) -> Result<(), MediaError> {
    let mut job = get_job(&job_id)?;
    if job.status != "prepared" {
        return Err(MediaError::new(
            "conflict",
            "Image has no prepared document asset",
        ));
    }
    if accepted {
        job.status = "committed".into();
        // Keep generation metadata, but never remove an accepted image on Undo.
        write_metadata(&app, &job).await?;
        if let Some(path) = job.preview_path.take() {
            let _ = tokio::fs::remove_file(path).await;
        }
        job.prepared_path = None;
    } else {
        if let Some(path) = job.prepared_path.take() {
            tokio::fs::remove_file(path)
                .await
                .map_err(|_| MediaError::new("storage", "Cannot roll back prepared image asset"))?;
        }
        job.asset_src = None;
        job.status = "ready".into();
        write_metadata(&app, &job).await?;
    }
    store(job);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permission_is_task_scoped_and_limits_include_retries() {
        let mut counts = HashMap::new();
        let mut permission = ImageTaskPermission {
            task_id: "task".into(),
            document_id: "document".into(),
            base_revision: 0,
            allow_automatic: false,
        };
        assert!(reserve(&mut counts, &permission).is_err());
        permission.allow_automatic = true;
        assert_eq!(reserve(&mut counts, &permission).unwrap(), 1);
        assert_eq!(reserve(&mut counts, &permission).unwrap(), 2);
        assert!(reserve(&mut counts, &permission).is_err());
        permission.document_id = "other-document".into();
        assert_eq!(reserve(&mut counts, &permission).unwrap(), 1);
    }
}
