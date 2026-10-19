// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer (2.42+) draws a blank or white window,
    // or crashes, on NVIDIA's proprietary driver - the most common "Textus
    // opens empty" report on Linux. Falling back to the older renderer costs
    // little for a text editor. Only on NVIDIA, and never over a value the
    // user set themselves. Set before any thread exists, which is what makes
    // set_var sound here.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        // SAFETY: first statement of main, single-threaded.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    #[cfg(all(target_os = "macos", debug_assertions))]
    dev_responsibility::run_as_own_responsible_process();
    textus_lib::run()
}

/// `tauri dev` runs a bare binary, not an .app. macOS then holds the
/// launching app (a terminal, an editor) responsible for privacy prompts and
/// checks ITS Info.plist: with no speech-recognition description there, the
/// first dictation kills Textus with a TCC abort. A dev build therefore
/// relaunches itself as its own responsible process - the way debuggers do -
/// so the usage descriptions embedded from Info.plist apply. Bundled builds
/// never take this path.
#[cfg(all(target_os = "macos", debug_assertions))]
mod dev_responsibility {
    use std::ffi::CString;

    const MARKER: &str = "TEXTUS_DEV_DISCLAIMED";

    extern "C" {
        fn responsibility_spawnattrs_setdisclaim(
            attr: *mut libc::posix_spawnattr_t,
            disclaim: libc::c_int,
        ) -> libc::c_int;
    }

    static CHILD: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

    extern "C" fn forward(signal: libc::c_int) {
        let child = CHILD.load(std::sync::atomic::Ordering::SeqCst);
        if child > 0 {
            // SAFETY: kill is async-signal-safe.
            unsafe { libc::kill(child, signal) };
        }
    }

    pub fn run_as_own_responsible_process() {
        if let Some(parent) = std::env::var_os(MARKER) {
            // The relaunched child: leave with the parent `tauri dev`
            // watches, so a rebuild or Ctrl+C never strands a second app.
            let parent: libc::pid_t = parent.to_string_lossy().parse().unwrap_or(0);
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if unsafe { libc::getppid() } != parent {
                    std::process::exit(0);
                }
            });
            return;
        }
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        if exe.to_string_lossy().contains(".app/Contents/MacOS/") {
            return;
        }
        let Ok(path) = CString::new(exe.to_string_lossy().as_bytes()) else {
            return;
        };
        let args: Vec<CString> = std::env::args()
            .filter_map(|a| CString::new(a).ok())
            .collect();
        let me = std::process::id().to_string();
        let mut env: Vec<CString> = std::env::vars()
            .filter_map(|(k, v)| CString::new(format!("{k}={v}")).ok())
            .collect();
        env.extend(CString::new(format!("{MARKER}={me}")).ok());
        let mut argv: Vec<*mut libc::c_char> = args.iter().map(|a| a.as_ptr() as *mut _).collect();
        argv.push(std::ptr::null_mut());
        let mut envp: Vec<*mut libc::c_char> = env.iter().map(|e| e.as_ptr() as *mut _).collect();
        envp.push(std::ptr::null_mut());
        // SAFETY: plain posix_spawn with NUL-terminated argument arrays that
        // outlive the call; the attribute is initialised and destroyed here.
        unsafe {
            let mut attr: libc::posix_spawnattr_t = std::mem::zeroed();
            if libc::posix_spawnattr_init(&mut attr) != 0 {
                return;
            }
            responsibility_spawnattrs_setdisclaim(&mut attr, 1);
            let mut pid: libc::pid_t = 0;
            let spawned = libc::posix_spawn(
                &mut pid,
                path.as_ptr(),
                std::ptr::null(),
                &attr,
                argv.as_ptr(),
                envp.as_ptr(),
            );
            libc::posix_spawnattr_destroy(&mut attr);
            if spawned != 0 {
                return; // Fall back to running in place.
            }
            // Ctrl+C / SIGTERM from `tauri dev` are passed on to the child.
            CHILD.store(pid, std::sync::atomic::Ordering::SeqCst);
            for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
                libc::signal(signal, forward as *const () as libc::sighandler_t);
            }
            let mut status = 0;
            libc::waitpid(pid, &mut status, 0);
            let code = if libc::WIFEXITED(status) {
                libc::WEXITSTATUS(status)
            } else {
                1
            };
            std::process::exit(code);
        }
    }
}
