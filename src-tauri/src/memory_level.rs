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
    std::thread::spawn(move || {
        let mut calm = 0;
        loop {
            std::thread::sleep(EVERY);
            let mut state = now();
            let was = LAST.load(Ordering::Relaxed);
            (state.pressure, calm) = settle(was, state.pressure, calm);
            if was != state.pressure {
                LAST.store(state.pressure, Ordering::Relaxed);
                crate::settings::emit_to_all(&app, EVENT, state);
            }
        }
    });
}

/// How many looks in a row the pressure must be lower before it eases: a
/// machine at the line would otherwise let views go and load them again
/// every look.
const CALM_LOOKS: u8 = 3;

/// The pressure to tell, from the one told (`was`) and the one read now: up
/// at once, down only after `CALM_LOOKS` lower looks. Gives the count too.
fn settle(was: u8, now: u8, calm: u8) -> (u8, u8) {
    if now >= was {
        return (now, 0);
    }
    if calm + 1 >= CALM_LOOKS {
        (now, 0)
    } else {
        (was, calm + 1)
    }
}

/// Pressure from the memory still free, as an amount: what a few views out
/// of sight take, not a share of the machine (a share left a big machine
/// short with gigabytes free, and a small one short all day).
#[cfg(any(test, target_os = "linux", windows))]
fn from_free(free: u64) -> u8 {
    const MB: u64 = 1024 * 1024;
    match free {
        f if f < 512 * MB => 2,
        f if f < 1024 * MB => 1,
        _ => 0,
    }
}

/// Linux's own pressure (PSI, /proc/pressure/memory): the share of the last
/// 10 s that tasks waited on memory. Some waiting is short, all of them
/// waiting is very short. None on a kernel without it.
#[cfg(any(test, target_os = "linux", target_os = "android"))]
fn from_psi(text: &str) -> Option<u8> {
    let avg10 = |kind: &str| -> Option<f64> {
        let line = text.lines().find(|l| l.starts_with(kind))?;
        line.split_whitespace()
            .find_map(|part| part.strip_prefix("avg10="))?
            .parse()
            .ok()
    };
    let (some, full) = (avg10("some")?, avg10("full").unwrap_or(0.0));
    Some(if full >= 5.0 {
        2
    } else if some >= 10.0 {
        1
    } else {
        0
    })
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
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

#[cfg(any(target_os = "macos", target_os = "ios"))]
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

#[cfg(any(target_os = "linux", target_os = "android"))]
fn meminfo(key: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with(key))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn total_bytes() -> u64 {
    meminfo("MemTotal:").unwrap_or(0)
}

// Android is Linux underneath: the same files, PSI where the system lets
// an app read it.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn pressure() -> u8 {
    let psi = std::fs::read_to_string("/proc/pressure/memory")
        .ok()
        .and_then(|text| from_psi(&text))
        .unwrap_or(0);
    psi.max(free_pressure())
}

#[cfg(target_os = "linux")]
fn free_pressure() -> u8 {
    meminfo("MemAvailable:").map_or(0, from_free)
}

/// Android keeps little free by design, its own killer freeing apps as it
/// needs: short only when what's left is a small share of the phone.
#[cfg(target_os = "android")]
fn free_pressure() -> u8 {
    match (meminfo("MemAvailable:"), meminfo("MemTotal:")) {
        (Some(free), Some(total)) if total > 0 => from_share(free, total),
        _ => 0,
    }
}

#[cfg(any(test, target_os = "android"))]
fn from_share(free: u64, total: u64) -> u8 {
    match free * 100 / total {
        p if p < 5 => 2,
        p if p < 10 => 1,
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
    status().map_or(0, |s| from_free(s.ullAvailPhys))
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn total_bytes() -> u64 {
    0
}

// iOS tells apps no level, and its web view's memory is another
// process's: the device's size alone sets the tier.
#[cfg(not(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn pressure() -> u8 {
    0
}

#[cfg(test)]
mod tests {
    const GB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn short_of_memory_is_an_amount_free_not_a_share() {
        // 4 GB free of 64 is plenty; 0.8 GB is short on any machine.
        assert_eq!(super::from_free(4 * GB), 0);
        assert_eq!(super::from_free(GB * 8 / 10), 1);
        assert_eq!(super::from_free(GB / 4), 2);
    }

    #[test]
    fn an_android_phone_is_short_by_the_share_left() {
        assert_eq!(super::from_share(GB, 8 * GB), 0);
        assert_eq!(super::from_share(GB * 6 / 10, 8 * GB), 1);
        assert_eq!(super::from_share(GB / 4, 8 * GB), 2);
    }

    #[test]
    fn linux_pressure_is_read_from_psi() {
        let calm = "some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1\n";
        let waiting = "some avg10=22.10 avg60=3.00 avg300=1.00 total=9\nfull avg10=1.00 avg60=0.10 avg300=0.00 total=2\n";
        let stalled = "some avg10=60.00 avg60=3.00 avg300=1.00 total=9\nfull avg10=30.00 avg60=0.10 avg300=0.00 total=2\n";
        assert_eq!(super::from_psi(calm), Some(0));
        assert_eq!(super::from_psi(waiting), Some(1));
        assert_eq!(super::from_psi(stalled), Some(2));
        assert_eq!(super::from_psi(""), None);
    }

    #[test]
    fn pressure_rises_at_once_and_eases_after_a_calm_minute() {
        assert_eq!(super::settle(0, 2, 0), (2, 0));
        // Lower looks: held until the third in a row.
        assert_eq!(super::settle(2, 0, 0), (2, 1));
        assert_eq!(super::settle(2, 0, 1), (2, 2));
        assert_eq!(super::settle(2, 0, 2), (0, 0));
        // A high look in between starts the count again.
        assert_eq!(super::settle(2, 2, 2), (2, 0));
    }

    #[test]
    fn this_machine_has_memory() {
        assert!(super::memory_state().total_mb > 0);
    }
}
