//! How many model calls a paper makes at once, and what it does when the
//! service says it is busy. Every stage steps through one `Throttled`, so
//! research helpers, writers and the reviewer together never have more calls
//! in flight than the provider bears; a call refused for its rate or an
//! overload waits and goes again, holding its slot while it waits, so the
//! paper slows down instead of piling on.

use super::model::{Model, Watch};
use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use futures_util::future::BoxFuture;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::{Semaphore, SemaphorePermit};

/// Tries of one call before its error stands.
const TRIES: u32 = 5;
/// The first wait; each one after is twice the last.
const FIRST_WAIT: Duration = Duration::from_secs(2);

/// Whether `error` reads as the service being busy rather than the request
/// being wrong: a 429, an overload, a gateway that couldn't get through.
/// Error strings are the dialects' `"... request failed ({status}): {body}"`.
pub(crate) fn is_busy(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    ["failed (429", "failed (502", "failed (503", "failed (529"]
        .iter()
        .any(|status| lower.contains(status))
        || [
            "overloaded",
            "rate limit",
            "rate_limit",
            "too many requests",
        ]
        .iter()
        .any(|said| lower.contains(said))
}

/// The wait before try `n` (1 for the first retry): doubling, with up to a
/// quarter more so calls refused together don't all come back together.
fn wait(n: u32, spread: u64) -> Duration {
    let base = FIRST_WAIT * 2u32.pow(n.saturating_sub(1).min(5));
    base + base.mul_f64((spread % 1000) as f64 / 4000.0)
}

/// A model with at most `at_once` steps in flight, a busy step tried again.
/// Each busy answer gives up a slot for good (one is always kept): a
/// provider that refuses this many at once is asked for fewer.
pub(crate) struct Throttled<'a, M: Model> {
    inner: &'a M,
    slots: Semaphore,
    at_once: AtomicUsize,
    /// Slots given up while every one was busy: the next to come back
    /// goes for good instead.
    to_drop: AtomicUsize,
}

/// A step's slot: back to the others when it ends, unless one is owed.
struct Slot<'s> {
    permit: Option<SemaphorePermit<'s>>,
    to_drop: &'s AtomicUsize,
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        let owed = self
            .to_drop
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                (n > 0).then(|| n - 1)
            });
        if let (Ok(_), Some(permit)) = (owed, self.permit.take()) {
            permit.forget();
        }
    }
}

impl<'a, M: Model> Throttled<'a, M> {
    pub(crate) fn new(inner: &'a M, at_once: usize) -> Self {
        let at_once = at_once.max(1);
        Self {
            inner,
            slots: Semaphore::new(at_once),
            at_once: AtomicUsize::new(at_once),
            to_drop: AtomicUsize::new(0),
        }
    }

    /// Gives up one slot, keeping one: a free one now, else the next back.
    fn ask_fewer(&self) {
        let fewer = self
            .at_once
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                (n > 1).then(|| n - 1)
            });
        if fewer.is_ok() && self.slots.forget_permits(1) == 0 {
            // Every slot is busy: given up as the first comes back.
            self.to_drop.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// `step` run in a slot, tried again while the service is busy and
    /// `again` says nothing of it has reached the paper yet.
    async fn run<'s, F>(
        &'s self,
        mut step: F,
        again: impl Fn() -> bool,
    ) -> Result<StepResult, String>
    where
        F: FnMut() -> BoxFuture<'s, Result<StepResult, String>>,
    {
        // Dropped with the future: a stopped paper frees its slot.
        let _slot = Slot {
            permit: Some(self.slots.acquire().await.map_err(|e| e.to_string())?),
            to_drop: &self.to_drop,
        };
        let mut tried = 0;
        loop {
            tried += 1;
            match step().await {
                Err(error) if tried < TRIES && is_busy(&error) && again() => {
                    self.ask_fewer();
                    let spread = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.subsec_nanos() as u64);
                    tokio::time::sleep(wait(tried, spread)).await;
                }
                result => return result,
            }
        }
    }
}

impl<M: Model> Model for Throttled<'_, M> {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(self.run(move || self.inner.step(instructions, turns, tools), || true))
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            // A step that streamed some of its answer isn't tried again: the
            // paper has shown it already.
            let streamed = AtomicBool::new(false);
            let seen = |event: aicompat::agent::ProviderEvent<'_>| {
                streamed.store(true, Ordering::Relaxed);
                watch(event)
            };
            let seen: Watch<'_> = &seen;
            self.run(
                move || self.inner.step_watched(instructions, turns, tools, seen),
                || !streamed.load(Ordering::Relaxed),
            )
            .await
        })
    }

    fn at_once(&self) -> usize {
        self.at_once.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// Sleeps a while each step, counting how many are in flight; fails
    /// with each of `errors` first, in turn.
    #[derive(Default)]
    struct Slow {
        now: AtomicUsize,
        most: AtomicUsize,
        calls: AtomicUsize,
        errors: Mutex<Vec<String>>,
    }

    impl Model for Slow {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            _turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                let now = self.now.fetch_add(1, Ordering::SeqCst) + 1;
                self.most.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(100)).await;
                self.now.fetch_sub(1, Ordering::SeqCst);
                let error = {
                    let mut errors = self.errors.lock().unwrap();
                    (!errors.is_empty()).then(|| errors.remove(0))
                };
                match error {
                    Some(error) => Err(error),
                    None => Ok(StepResult::Done("ok".into())),
                }
            })
        }
    }

    #[tokio::test(start_paused = true)]
    async fn no_more_steps_than_its_slots_run_at_once() {
        let slow = Slow::default();
        let throttled = Throttled::new(&slow, 3);
        let steps = (0..10).map(|_| throttled.step("", &[], &[]));
        let results = futures_util::future::join_all(steps).await;
        assert!(results.iter().all(Result::is_ok));
        assert_eq!(slow.most.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_busy_step_waits_and_goes_again() {
        let slow = Slow::default();
        *slow.errors.lock().unwrap() = vec![
            "Claude request failed (429 Too Many Requests): rate limited".into(),
            "{\"type\":\"overloaded_error\"}".into(),
        ];
        let throttled = Throttled::new(&slow, 2);
        let started = tokio::time::Instant::now();
        assert!(throttled.step("", &[], &[]).await.is_ok());
        assert_eq!(slow.calls.load(Ordering::SeqCst), 3);
        // Two waits, 2 s and 4 s at the least.
        assert!(started.elapsed() >= Duration::from_secs(6));
    }

    #[tokio::test(start_paused = true)]
    async fn a_step_wrong_in_itself_is_not_tried_again() {
        let slow = Slow::default();
        *slow.errors.lock().unwrap() = vec!["request failed (400): bad tool schema".into()];
        let throttled = Throttled::new(&slow, 2);
        assert!(throttled.step("", &[], &[]).await.is_err());
        assert_eq!(slow.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_service_busy_every_time_gives_up_after_its_tries() {
        let slow = Slow::default();
        *slow.errors.lock().unwrap() = vec!["request failed (429): slow down".into(); 10];
        let throttled = Throttled::new(&slow, 1);
        let error = throttled.step("", &[], &[]).await.err().unwrap();
        assert!(error.contains("429"));
        assert_eq!(slow.calls.load(Ordering::SeqCst), TRIES as usize);
    }

    #[tokio::test(start_paused = true)]
    async fn a_stopped_step_frees_its_slot() {
        let slow = Slow::default();
        let throttled = Throttled::new(&slow, 1);
        // Stopped mid-call, as ai_cancel drops a paper's future.
        let stopped = tokio::time::timeout(Duration::from_millis(10), throttled.step("", &[], &[]));
        assert!(stopped.await.is_err());
        let next = tokio::time::timeout(Duration::from_secs(1), throttled.step("", &[], &[]));
        assert!(next.await.unwrap().is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn a_busy_answer_asks_for_one_fewer_at_once() {
        let slow = Slow::default();
        *slow.errors.lock().unwrap() = vec!["request failed (429): slow down".into()];
        let throttled = Throttled::new(&slow, 3);
        assert!(throttled.step("", &[], &[]).await.is_ok());
        assert_eq!(throttled.at_once(), 2);
        let steps = (0..6).map(|_| throttled.step("", &[], &[]));
        futures_util::future::join_all(steps).await;
        assert_eq!(slow.most.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_busy_answer_with_every_slot_taken_still_asks_for_fewer() {
        let slow = Slow::default();
        *slow.errors.lock().unwrap() = vec!["request failed (429): slow down".into()];
        let throttled = Throttled::new(&slow, 3);
        let full = (0..3).map(|_| throttled.step("", &[], &[]));
        futures_util::future::join_all(full).await;
        assert_eq!(throttled.at_once(), 2);
        slow.most.store(0, Ordering::SeqCst);
        let steps = (0..6).map(|_| throttled.step("", &[], &[]));
        futures_util::future::join_all(steps).await;
        assert_eq!(slow.most.load(Ordering::SeqCst), 2);
    }

    /// Streams some text, then the service says it is busy.
    #[derive(Default)]
    struct Cut(AtomicUsize);

    impl Model for Cut {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            _turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            unreachable!()
        }

        fn step_watched<'a>(
            &'a self,
            _instructions: &'a str,
            _turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
            watch: Watch<'a>,
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            watch(aicompat::agent::ProviderEvent::Text("Half a"));
            Box::pin(async { Err("stream error: overloaded".into()) })
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_step_cut_off_mid_answer_is_not_tried_again() {
        let cut = Cut::default();
        let throttled = Throttled::new(&cut, 2);
        let shown = Mutex::new(String::new());
        let watch = |e: aicompat::agent::ProviderEvent<'_>| {
            if let aicompat::agent::ProviderEvent::Text(t) = e {
                shown.lock().unwrap().push_str(t);
            }
        };
        assert!(throttled.step_watched("", &[], &[], &watch).await.is_err());
        assert_eq!(cut.0.load(Ordering::SeqCst), 1);
        assert_eq!(*shown.lock().unwrap(), "Half a");
    }

    #[test]
    fn busy_is_read_from_the_status_or_the_body() {
        assert!(is_busy("OpenAI request failed (429 Too Many Requests): {}"));
        assert!(is_busy(
            "Claude request failed (529 <unknown status code>): overloaded"
        ));
        assert!(is_busy("stream error: rate_limit_error"));
        assert!(!is_busy(
            "Claude request failed (401 Unauthorized): bad key"
        ));
        assert!(!is_busy(
            "Claude request failed (400 Bad Request): too long"
        ));
        assert!(!is_busy(
            "request failed (400): see docs (429 is our limit)"
        ));
    }

    #[test]
    fn every_provider_makes_a_call_at_least() {
        for entry in crate::ai::catalog::PROVIDER_CATALOG {
            assert!(entry.paper_at_once >= 1, "{}", entry.id);
        }
    }

    #[test]
    fn waits_double_with_a_little_spread() {
        assert_eq!(wait(1, 0), Duration::from_secs(2));
        assert_eq!(wait(3, 0), Duration::from_secs(8));
        assert!(wait(1, 999) < Duration::from_millis(2500));
    }
}
