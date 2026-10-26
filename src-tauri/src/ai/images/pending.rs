//! Pictures being made or made and not saved yet, by id: kept in memory
//! for the frontend to fetch, bounded in count and bytes.

use super::*;

/// A picture asked for: still being made, made, or not made and why.
pub(crate) enum Slot {
    Making,
    Ready(GeneratedImage),
    Failed(String),
}

impl Slot {
    pub(crate) fn bytes(&self) -> usize {
        match self {
            Slot::Ready(image) => image.bytes.len(),
            _ => 0,
        }
    }
}

/// The pictures waiting for a decision, newest last. Bounded: a long
/// session of undecided pictures must not hold hundreds of megabytes; the
/// oldest go first (and its proposal can then no longer be accepted - the
/// frontend says so).
pub(crate) static PENDING: Mutex<Vec<(String, Slot)>> = Mutex::new(Vec::new());

#[cfg(not(test))]
pub(crate) const PENDING_COUNT: usize = 16;
// The tests run side by side and share the list: kept to sixteen, one
// test's pictures pushed out another's while it was looking at them.
#[cfg(test)]
pub(crate) const PENDING_COUNT: usize = 1024;

pub(crate) const PENDING_BYTES: usize = 128 * 1024 * 1024;

/// How long the frontend waits for a picture still being made: the
/// slowest services take about two minutes, and give up at three.
pub(crate) const WAIT_FOR_PICTURE: std::time::Duration = std::time::Duration::from_secs(200);

pub(crate) fn pending() -> std::sync::MutexGuard<'static, Vec<(String, Slot)>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// A new picture's id, its slot marked as being made.
pub(crate) fn begin() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    // Short, and unlike the one before: the model copies it into its text,
    // and two long ids differing in their last digits were copied wrong
    // (one picture drawn in two places). Six letters and digits from a
    // mix of the time and a counter.
    let mut x = (nanos as u64) ^ ((NEXT.fetch_add(1, Ordering::Relaxed) as u64) << 40);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^= x >> 31;
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let id: String = (0..6)
        .map(|i| DIGITS[((x >> (i * 6)) % 36) as usize] as char)
        .collect();
    let mut pending = pending();
    pending.push((id.clone(), Slot::Making));
    while pending.len() > PENDING_COUNT
        || pending.iter().map(|(_, s)| s.bytes()).sum::<usize>() > PENDING_BYTES
    {
        pending.remove(0);
    }
    id
}

/// What each pending picture was asked for, so one that wasn't made can be
/// asked for again by itself (ai_retry_generated_image). Kept for as long
/// as its slot is.
pub(crate) struct Asked {
    pub(crate) job: ImageJob,
    pub(crate) prompt: String,
    pub(crate) aspect: Aspect,
    pub(crate) reference: Option<Reference>,
}

/// A picture a new one is drawn from, where the service takes one
/// (ImageApi::takes_reference).
#[derive(Clone)]
pub(crate) enum Reference {
    /// The picture being redone (`replace`), changed as the description
    /// says.
    Change(ImageAttachment),
    /// An earlier picture (`like`) whose people and style the new one
    /// keeps - a new scene, not a change to that one.
    Like(ImageAttachment),
}

/// What a picture drawn like another is asked for, before its own
/// description: the services read a picture sent with the description as
/// one to change.
pub(crate) const LIKE: &str = "A new picture, not a copy of the attached one: keep the people, animals and places from the attached picture looking as they do there, and keep its style. The new picture: ";

impl Asked {
    /// The description and picture the service is sent.
    pub(crate) fn sent(&self) -> (std::borrow::Cow<'_, str>, Option<&ImageAttachment>) {
        match &self.reference {
            None => (self.prompt.as_str().into(), None),
            Some(Reference::Change(picture)) => (self.prompt.as_str().into(), Some(picture)),
            Some(Reference::Like(picture)) => {
                (format!("{LIKE}{}", self.prompt).into(), Some(picture))
            }
        }
    }
}

pub(crate) static ASKED: Mutex<Vec<(String, std::sync::Arc<Asked>)>> = Mutex::new(Vec::new());

pub(crate) fn asked() -> std::sync::MutexGuard<'static, Vec<(String, std::sync::Arc<Asked>)>> {
    ASKED.lock().unwrap_or_else(|e| e.into_inner())
}

/// Makes picture `id` from what was asked, in the background, its slot
/// filled when it comes.
pub(crate) fn make(id: String, asked_for: std::sync::Arc<Asked>) {
    {
        let mut asked = asked();
        asked.retain(|(i, _)| *i != id);
        asked.push((id.clone(), asked_for.clone()));
        let live: Vec<String> = pending().iter().map(|(i, _)| i.clone()).collect();
        asked.retain(|(i, _)| live.contains(i));
    }
    tauri::async_runtime::spawn(async move {
        let (prompt, reference) = asked_for.sent();
        let slot = match asked_for
            .job
            .generate(&prompt, asked_for.aspect, reference)
            .await
        {
            Ok(image) => Slot::Ready(image),
            Err(why) => Slot::Failed(why.to_string()),
        };
        finish(&id, slot);
    });
}

/// Asks again for a picture that wasn't made: its slot goes back to being
/// made. Err when it is gone, or not one that failed.
pub(crate) fn retry(id: &str) -> Result<(), String> {
    let asked_for = asked()
        .iter()
        .find(|(i, _)| i == id)
        .map(|(_, a)| a.clone())
        .ok_or_else(|| "This picture is no longer available - ask for it again.".to_string())?;
    {
        let mut pending = pending();
        let Some((_, slot)) = pending.iter_mut().find(|(i, _)| i == id) else {
            return Err("This picture is no longer available - ask for it again.".into());
        };
        if !matches!(slot, Slot::Failed(_)) {
            return Err("This picture was made, or is being made.".into());
        }
        *slot = Slot::Making;
    }
    make(id.to_string(), asked_for);
    Ok(())
}

/// The description picture `id` was asked for with, while it is kept.
pub(crate) fn prompt_of(id: &str) -> Option<String> {
    asked()
        .iter()
        .find(|(i, _)| i == id)
        .map(|(_, a)| a.prompt.clone())
}

/// Makes picture `id` again from `prompt` - the writer's change to its
/// description - with the same service, shape and reference; made or
/// not, it goes back to being made. Err when it is gone, or still being
/// made.
pub(crate) fn redraw(id: &str, prompt: String) -> Result<(), String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Describe the picture to draw.".into());
    }
    let gone = || "This picture is no longer available - ask for it again.".to_string();
    let before = asked()
        .iter()
        .find(|(i, _)| i == id)
        .map(|(_, a)| a.clone())
        .ok_or_else(gone)?;
    {
        let mut pending = pending();
        let Some((_, slot)) = pending.iter_mut().find(|(i, _)| i == id) else {
            return Err(gone());
        };
        if matches!(slot, Slot::Making) {
            return Err("This picture is still being made.".into());
        }
        *slot = Slot::Making;
    }
    make(
        id.to_string(),
        std::sync::Arc::new(Asked {
            job: before.job.clone(),
            prompt,
            aspect: before.aspect,
            reference: before.reference.clone(),
        }),
    );
    Ok(())
}

/// A made picture's file contents and extension, for keeping it with its
/// document (ai/kept_proposals.rs). None while it is made, or when it
/// failed or is gone.
pub(crate) fn ready_bytes(id: &str) -> Option<(Vec<u8>, &'static str)> {
    pending()
        .iter()
        .find(|(i, _)| i == id)
        .and_then(|(_, slot)| match slot {
            Slot::Ready(image) => Some((image.bytes.clone(), image.ext)),
            _ => None,
        })
}

/// Puts back a picture kept with its document, made in an earlier run of
/// the app, under its id - unless one by that id is waiting already.
pub(crate) fn restore(id: &str, image: GeneratedImage) {
    let mut pending = pending();
    if pending.iter().any(|(i, _)| i == id) {
        return;
    }
    pending.push((id.to_string(), Slot::Ready(image)));
    while pending.len() > PENDING_COUNT
        || pending.iter().map(|(_, s)| s.bytes()).sum::<usize>() > PENDING_BYTES
    {
        pending.remove(0);
    }
}

/// What came of a picture being made. Nothing, if it was let go meanwhile
/// (its proposal rejected while it was painting).
pub(crate) fn finish(id: &str, slot: Slot) {
    let mut pending = pending();
    if let Some((_, waiting)) = pending.iter_mut().find(|(i, _)| i == id) {
        *waiting = slot;
    }
    while pending.iter().map(|(_, s)| s.bytes()).sum::<usize>() > PENDING_BYTES {
        pending.remove(0);
    }
}

/// The size a picture is asked for at `aspect`, as GPT image makes it: the
/// frame's shape while it is made (the service rounds to its own).
pub(crate) fn nominal_size(aspect: Aspect) -> (u32, u32) {
    let size = gen::gpt_image_size(aspect);
    let (w, h) = size.split_once('x').unwrap_or(("1024", "1024"));
    (w.parse().unwrap_or(1024), h.parse().unwrap_or(1024))
}

/// A pending picture as the frontend takes it - generated into
/// src/platform/bindings/ai-agent.ts.
#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageData {
    pub(crate) mime: &'static str,
    pub(crate) ext: &'static str,
    pub(crate) data_base64: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// Picture `id` as a picture to send a service, once it is made - for a
/// new one drawn like it (Reference::Like). None while it is being made:
/// a new picture doesn't wait for it.
pub(crate) fn made_picture(id: &str) -> Option<ImageAttachment> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pending = pending();
    match pending.iter().find(|(i, _)| i == id) {
        Some((_, Slot::Ready(image))) => Some(ImageAttachment {
            name: format!("{id}.{}", image.ext),
            mime: image.mime.to_string(),
            data_base64: STANDARD.encode(&image.bytes),
        }),
        _ => None,
    }
}

/// What a picture's slot holds now: the picture, why it wasn't made, or
/// None while it is being made.
pub(crate) fn look(id: &str) -> Option<Result<GeneratedImageData, String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pending = pending();
    let Some((_, slot)) = pending.iter().find(|(i, _)| i == id) else {
        return Some(Err(
            "This picture is no longer available - ask for it again.".to_string(),
        ));
    };
    match slot {
        Slot::Making => None,
        Slot::Failed(why) => Some(Err(why.clone())),
        Slot::Ready(image) => Some(Ok(GeneratedImageData {
            mime: image.mime,
            ext: image.ext,
            data_base64: STANDARD.encode(&image.bytes),
            width: image.width,
            height: image.height,
        })),
    }
}
