//! Lets the frontend abort an in-flight `ai_agent_message` request (the
//! chat "stop" button). Keyed by a frontend-generated request id rather than
//! any window/tab identity, since the pairing is 1:1 with a single in-flight
//! `send()` call regardless of which tab or window it came from.
//!
//! A plain static registry (same precedent as aicompat::http's PROXY_URL)
//! rather than Tauri-managed state - nothing here needs an AppHandle, and it
//! sidesteps holding a `tauri::State` across the command's `.await`.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub const CANCELLED: &str = "cancelled";

static PENDING: Mutex<Option<HashMap<String, oneshot::Sender<()>>>> = Mutex::new(None);

/// Registers `request_id` as cancellable and returns the receiver side to
/// race against the actual request future (see ai_agent_message).
fn register(request_id: String) -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    PENDING
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(request_id, tx);
    rx
}

/// Runs `work` until it finishes or `request_id` is cancelled, whichever
/// comes first. Cancelling drops `work` where it is waiting - the provider's
/// stream, a web search, a picture being made (the agent loop's tools are
/// async for this) - so Stop takes effect at once.
pub async fn cancellable<T>(
    request_id: String,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let cancelled = register(request_id.clone());
    let result = tokio::select! {
        result = work => result,
        _ = cancelled => Err(CANCELLED.to_string()),
    };
    unregister(&request_id);
    result
}

/// Drops the registration whether the request finished, failed, or was
/// itself the one that got cancelled - a stale entry would otherwise leak
/// for the lifetime of the app and let a reused id "cancel" a later request.
fn unregister(request_id: &str) {
    if let Some(map) = PENDING.lock().unwrap().as_mut() {
        map.remove(request_id);
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_cancel(request_id: String) {
    if let Some(tx) = PENDING
        .lock()
        .unwrap()
        .as_mut()
        .and_then(|m| m.remove(&request_id))
    {
        let _ = tx.send(()); // receiver may already be gone if the request just finished on its own
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aicompat::agent::{run_agent_loop, AgentTurn, StepResult, ToolCall, ToolRun};
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Set when the future holding it is dropped.
    struct DropFlag<'a>(&'a AtomicBool);

    impl Drop for DropFlag<'_> {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    /// Stop while a tool is waiting (a search that never answers): the
    /// request ends at once as cancelled, and the tool's work is dropped
    /// rather than left running.
    #[test]
    fn stop_cancels_a_tool_in_flight() {
        let dropped = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(cancellable(
            "cancel-test".into(),
            run_agent_loop(
                vec![],
                AgentTurn::User {
                    text: "search".into(),
                    images: Vec::new(),
                },
                12,
                |_| async {
                    Ok(StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                        call_id: "s".into(),
                        name: "web_search".into(),
                        arguments: "{}".into(),
                        reasoning: None,
                    }]))
                },
                |_: ToolCall| {
                    let flag = DropFlag(&dropped);
                    async move {
                        let _flag = flag;
                        ai_cancel("cancel-test".into());
                        std::future::pending::<String>().await
                    }
                },
                |_| ToolRun::Concurrent,
                |_| {},
            ),
        ));
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert!(
            dropped.load(Ordering::SeqCst),
            "the tool's work was dropped"
        );
        // The registration is gone, so a reused id cancels nothing later.
        assert!(PENDING
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|m| !m.contains_key("cancel-test")));
    }
}
