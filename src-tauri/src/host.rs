use std::path::Path;
use std::time::{Duration, Instant};

use sillage_host::{Backend, HostClient};

const FLAG: &str = "--host";

/// `sillage.exe --host`: runs the terminal daemon; returns false outside host mode.
pub fn run_cli() -> bool {
    if std::env::args().nth(1).as_deref() != Some(FLAG) {
        return false;
    }
    if let Ok(name) = sillage_host::pipe_name() {
        #[cfg(windows)]
        let _ = sillage_host::server::serve(&name, sillage_host::IDLE_EXIT);
        #[cfg(not(windows))]
        let _ = name;
    }
    true
}

pub fn backend(data_dir: &Path) -> Backend {
    if std::env::var_os("SILLAGE_NO_HOST").is_some() {
        return Backend::local();
    }
    let Ok(name) = sillage_host::pipe_name() else {
        return Backend::local();
    };
    let dir = data_dir.join("host");
    Backend::with_host(move || connect_or_launch(&name, &dir))
}

fn connect_or_launch(name: &str, dir: &Path) -> Option<HostClient> {
    if let Ok(c) = HostClient::connect(name) {
        return Some(c);
    }
    launch(dir).ok()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
        if let Ok(c) = HostClient::connect(name) {
            return Some(c);
        }
    }
    None
}

#[cfg(windows)]
fn stale(src: &Path, dst: &Path) -> bool {
    let (Ok(s), Ok(d)) = (src.metadata(), dst.metadata()) else {
        return true;
    };
    s.len() != d.len() || matches!((s.modified(), d.modified()), (Ok(a), Ok(b)) if a > b)
}

#[cfg(windows)]
/// Runs from a versioned copy so that updating `Sillage.exe` never meets a locked file.
fn install_copy(dir: &Path) -> std::io::Result<std::path::PathBuf> {
    let exe = std::env::current_exe()?;
    let src_dir = exe.parent().unwrap_or(dir);
    std::fs::create_dir_all(dir)?;
    let target = dir.join(format!("sillage-host-{}.exe", env!("CARGO_PKG_VERSION")));
    for entry in std::fs::read_dir(dir)?.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if p != target && name.starts_with("sillage-host-") && name.ends_with(".exe") {
            let _ = std::fs::remove_file(&p);
        }
    }
    if stale(&exe, &target) {
        if let Err(e) = std::fs::copy(&exe, &target) {
            if !target.exists() {
                return Err(e);
            }
        }
    }
    for entry in std::fs::read_dir(src_dir)?.flatten() {
        let p = entry.path();
        let dll = p.extension().is_some_and(|x| x.eq_ignore_ascii_case("dll"));
        let dst = dir.join(entry.file_name());
        if dll && stale(&p, &dst) {
            let _ = std::fs::copy(&p, &dst);
        }
    }
    Ok(target)
}

#[cfg(windows)]
fn launch(dir: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

    std::fs::create_dir_all(dir)?;
    let program = install_copy(dir).or_else(|_| std::env::current_exe())?;
    let base = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    let spawn = |flags: u32| {
        Command::new(&program)
            .arg(FLAG)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(flags)
            .spawn()
    };
    spawn(base | CREATE_BREAKAWAY_FROM_JOB)
        .or_else(|_| spawn(base))
        .map(|_| ())
}

#[cfg(not(windows))]
fn launch(_dir: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}
