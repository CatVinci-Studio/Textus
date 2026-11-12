//! How much memory the machine has and how short of it the system is now,
//! for the windows' memory policy (memory-policy.ts): read at start, then
//! looked at again every so often and told to every window when it moves.

use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

/// The machine's memory and the system's pressure: 0 none, 1 short, 2 very.
#[derive(Clone, Copy, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MemoryState {
    total_mb: u32,
    pressure: u8,
}

/// The windows hear of a change in pressure by this event.
const EVENT: &str = "memory-level";
const EVERY: Duration = Duration::from_secs(20);
static LAST: AtomicU8 = AtomicU8::new(0);

fn now() -> MemoryState {
    MemoryState {
        total_mb: (total_bytes() / (1024 * 1024)).min(u32::MAX as u64) as u32,
        pressure: pressure(),
    }
}

/// The memory state now, for a window as it starts.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn memory_state() -> MemoryState {
    now()
}

/// Looks at the pressure every `EVERY` and tells the windows when it moves.
pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(EVERY);
        let state = now();
        if LAST.swap(state.pressure, Ordering::Relaxed) != state.pressure {
            crate::settings::emit_to_all(&app, EVENT, state);
        }
    });
}

/// Pressure from the share of memory still free: below 10% short, below 5%
/// very short.
#[cfg(any(test, target_os = "linux", windows))]
fn from_free_share(free: u64, total: u64) -> u8 {
    match (free * 100).checked_div(total) {
        Some(p) if p < 5 => 2,
        Some(p) if p < 10 => 1,
        _ => 0,
    }
}

#[cfg(target_os = "macos")]
fn sysctl_u64(name: &str) -> Option<u64> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut value: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    // SAFETY: a read-only sysctl into a u64 of the size given.
    let ok = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } == 0;
    // A 32-bit value fills the low half.
    ok.then_some(if size == 4 {
        value & 0xffff_ffff
    } else {
        value
    })
}

#[cfg(target_os = "macos")]
fn total_bytes() -> u64 {
    sysctl_u64("hw.memsize").unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn pressure() -> u8 {
    // The kernel's own level: 1 normal, 2 warning, 4 critical.
    match sysctl_u64("kern.memorystatus_vm_pressure_level") {
        Some(4) => 2,
        Some(2) => 1,
        _ => 0,
    }
}

#[cfg(target_os = "linux")]
fn meminfo(key: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with(key))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(target_os = "linux")]
fn total_bytes() -> u64 {
    meminfo("MemTotal:").unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn pressure() -> u8 {
    match (meminfo("MemAvailable:"), meminfo("MemTotal:")) {
        (Some(free), Some(total)) => from_free_share(free, total),
        _ => 0,
    }
}

#[cfg(windows)]
fn status() -> Option<windows::Win32::System::SystemInformation::MEMORYSTATUSEX> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: a struct of the size it says, filled by the system.
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some(status)
}

#[cfg(windows)]
fn total_bytes() -> u64 {
    status().map_or(0, |s| s.ullTotalPhys)
}

#[cfg(windows)]
fn pressure() -> u8 {
    status().map_or(0, |s| from_free_share(s.ullAvailPhys, s.ullTotalPhys))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn total_bytes() -> u64 {
    0
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn pressure() -> u8 {
    0
}

#[cfg(test)]
mod tests {
    #[test]
    fn short_of_memory_is_read_from_what_is_free() {
        assert_eq!(super::from_free_share(50, 100), 0);
        assert_eq!(super::from_free_share(8, 100), 1);
        assert_eq!(super::from_free_share(3, 100), 2);
        assert_eq!(super::from_free_share(3, 0), 0);
    }

    #[test]
    fn this_machine_has_memory() {
        assert!(super::memory_state().total_mb > 0);
    }
}
