//! A lock taken whether or not a thread panicked while holding it: what it
//! guards here is plain data, good as it stands, and refusing it would turn
//! one thread's panic into every later caller's.

use std::sync::{Mutex, MutexGuard};

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
