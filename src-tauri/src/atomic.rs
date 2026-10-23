//! Write-then-rename helpers so a crash or power loss mid-write can't leave
//! a half-written file where a config/session/document used to be. The temp
//! file lives next to its target (same directory, same filesystem) so the
//! final rename is atomic rather than a cross-volume copy.
//!
//! A rename alone isn't enough: the filesystem may commit the rename before
//! the data, so after a power loss the target names an empty or truncated
//! file. Each writer therefore syncs the temp file before the rename, and
//! on Unix the directory after it, so the new name itself is on disk.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn tmp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".{name}.{stamp}-{seq}.tmp");
    target.with_file_name(tmp_name)
}

/// Makes a completed rename in `target`'s directory durable. Best effort:
/// some filesystems (network mounts, a few FUSE ones) refuse to fsync a
/// directory, and by then the data itself is already safely written.
fn sync_parent_dir(target: &Path) {
    #[cfg(unix)]
    if let Some(dir) = target.parent() {
        let dir = if dir.as_os_str().is_empty() {
            Path::new(".")
        } else {
            dir
        };
        if let Ok(handle) = std::fs::File::open(dir) {
            let _ = handle.sync_all();
        }
    }
    // Windows has no directory handles to sync; NTFS journals the rename.
    #[cfg(not(unix))]
    let _ = target;
}

/// What replacing an existing file has to carry over: where it really is
/// (a symlink is written through, not replaced by a regular file) and its
/// permissions (the new file would otherwise get the default mode, and a
/// read-only file would quietly become writable). A read-only file is not
/// replaced at all: the user made it so, and the save says why it failed.
fn existing_target(target: &Path) -> std::io::Result<(PathBuf, Option<std::fs::Permissions>)> {
    let real = match std::fs::canonicalize(target) {
        Ok(real) => real,
        Err(_) => return Ok((target.to_path_buf(), None)),
    };
    let permissions = std::fs::metadata(&real)?.permissions();
    if permissions.readonly() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("{} is read-only", real.display()),
        ));
    }
    Ok((real, Some(permissions)))
}

fn write_via_temp(target: &Path, contents: &[u8], secret: bool) -> std::io::Result<()> {
    // Secrets always get a fresh owner-only file; anything else keeps what
    // the file it replaces had.
    let (real, permissions) = if secret {
        (target.to_path_buf(), None)
    } else {
        existing_target(target)?
    };
    let target = real.as_path();
    let tmp = tmp_path(target);
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = secret;
        let mut file = options.open(&tmp)?;
        file.write_all(contents)?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, target)
    })();
    match result {
        Ok(()) => {
            sync_parent_dir(target);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Sync version, for the handful of call sites that aren't already async.
pub fn write_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    write_via_temp(target, contents.as_ref(), false)
}

/// For credentials and API keys: the same write-then-rename, with the temp
/// file created owner-only (0600) on Unix from the start. Writing first and
/// tightening permissions after left a window where the secret sat in a
/// world-readable file, and a crash in between left it that way.
pub fn write_secret_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    write_via_temp(target, contents.as_ref(), true)
}

/// Async version: the same steps on the blocking pool, since fsync can
/// take a while (tens of milliseconds on macOS, where it flushes the
/// drive's cache) and mustn't stall the runtime's workers.
pub async fn write(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let target = target.to_path_buf();
    let contents = contents.as_ref().to_vec();
    tokio::task::spawn_blocking(move || write_via_temp(&target, &contents, false))
        .await
        .map_err(std::io::Error::other)?
}

/// Creates `<temp dir>/<prefix><random><suffix>` with `create`, which has
/// to fail with AlreadyExists rather than open whatever is already there; a
/// name that is taken is retried with another.
fn create_unique<T>(
    prefix: &str,
    suffix: &str,
    create: impl Fn(&Path) -> std::io::Result<T>,
) -> std::io::Result<(PathBuf, T)> {
    use std::hash::{BuildHasher, Hasher};
    let dir = std::env::temp_dir();
    let mut attempts = 0;
    loop {
        // RandomState is seeded from the OS's randomness: enough to make
        // the name unguessable without a dependency for it.
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u32(std::process::id());
        hasher.write_u32(COUNTER.fetch_add(1, Ordering::Relaxed));
        let path = dir.join(format!("{prefix}{:016x}{suffix}", hasher.finish()));
        match create(&path) {
            Ok(made) => return Ok((path, made)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempts < 16 => {
                attempts += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// A new file only its owner can read or write. Created exclusively: an
/// existing file is an error, and so is a symlink, which isn't followed.
fn create_private_file(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// A new folder only its owner can enter. Like the file, an existing folder
/// or symlink of that name is an error rather than reused.
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(path)
}

/// A scratch file in the system temp directory, removed again when this is
/// dropped - on every path out of the code holding it, early returns and
/// panics included.
///
/// On Linux the temp directory is a shared /tmp, so a fixed or guessable
/// name lets another local user plant a file or symlink there first and
/// have us write into it - and the CLI installer then copies that file
/// into /usr/local/bin as root. So the name carries a random part, the
/// file is created exclusively (never opening an existing file, nor
/// following a symlink), and on Unix only its owner can read or write it.
// Used by the desktop-only PDF export and CLI installer.
#[cfg_attr(mobile, allow(dead_code))]
pub struct TempFile {
    path: PathBuf,
}

#[cfg_attr(mobile, allow(dead_code))]
impl TempFile {
    /// Creates `<temp dir>/<prefix><random><suffix>` holding `contents`.
    pub fn create(prefix: &str, suffix: &str, contents: impl AsRef<[u8]>) -> std::io::Result<Self> {
        let (path, mut file) = create_unique(prefix, suffix, create_private_file)?;
        // Owned from here, so a failed write still cleans up.
        let temp = TempFile { path };
        file.write_all(contents.as_ref())?;
        Ok(temp)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A scratch folder in the system temp directory, for a file that has to
/// keep its own name (PicGo uploads a file under the name it has). It is
/// made with the care [`TempFile`] takes: a random name, created fresh and
/// owner-only, and its files created exclusively. Dropping it removes the
/// files written through it and then the folder - also when it is held by
/// a future that is dropped before it finishes.
pub struct TempDir {
    path: PathBuf,
    files: Vec<PathBuf>,
}

impl TempDir {
    /// Creates `<temp dir>/<prefix><random>`, empty.
    pub fn create(prefix: &str) -> std::io::Result<Self> {
        let (path, ()) = create_unique(prefix, "", create_private_dir)?;
        Ok(TempDir {
            path,
            files: Vec::new(),
        })
    }

    /// Writes `contents` to a new file `name` in the folder; returns its path.
    pub fn write_file(
        &mut self,
        name: &str,
        contents: impl AsRef<[u8]>,
    ) -> std::io::Result<PathBuf> {
        if Path::new(name).file_name() != Some(name.as_ref()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{name} is not a file name"),
            ));
        }
        let path = self.path.join(name);
        let mut file = create_private_file(&path)?;
        self.files.push(path.clone());
        file.write_all(contents.as_ref())?;
        Ok(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Only what this made is removed: its own files, then the folder,
        // which is left alone if anything else is in it.
        for file in &self.files {
            let _ = std::fs::remove_file(file);
        }
        let _ = std::fs::remove_dir(&self.path);
    }
}

#[cfg(test)]
mod tests;
