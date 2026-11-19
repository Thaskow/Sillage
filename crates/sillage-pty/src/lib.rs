use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("session {0} introuvable ou terminée")]
    NotFound(String),
    #[error("session {0} déjà démarrée")]
    AlreadyRunning(String),
    #[error("impossible de démarrer « {program} » : {reason}")]
    Spawn { program: String, reason: String },
    #[error("terminal : {0}")]
    Io(String),
}

pub type Result<T> = std::result::Result<T, PtyError>;

#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExitInfo {
    pub code: Option<u32>,
    pub killed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInfo {
    pub id: String,
    pub pid: Option<u32>,
    pub started_at: i64,
}

pub type OutputFn = Box<dyn Fn(&[u8]) + Send + 'static>;
pub type ExitFn = Box<dyn FnOnce(ExitInfo) + Send + 'static>;

struct Session {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    killed: Mutex<bool>,
    pid: Option<u32>,
    started_at: i64,
}

#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 1000),
        cols: cols.clamp(2, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| PtyError::NotFound(id.into()))
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(id)
    }

    pub fn spawn(
        &self,
        id: &str,
        spec: LaunchSpec,
        on_output: OutputFn,
        on_exit: ExitFn,
    ) -> Result<RunningInfo> {
        if self.is_running(id) {
            return Err(PtyError::AlreadyRunning(id.into()));
        }
        let program = spec.program.display().to_string();
        let spawn_err = |reason: String| PtyError::Spawn {
            program: program.clone(),
            reason,
        };

        let pair = native_pty_system()
            .openpty(size(spec.cols, spec.rows))
            .map_err(|e| spawn_err(e.to_string()))?;
        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            if !cwd.is_dir() {
                return Err(spawn_err(format!(
                    "le dossier {} n'existe plus",
                    cwd.display()
                )));
            }
            cmd.cwd(cwd);
        }
        cmd.env("COLORTERM", "truecolor");
        if !cfg!(windows) {
            cmd.env("TERM", "xterm-256color");
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| spawn_err(e.to_string()))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Io(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Io(e.to_string()))?;

        let session = Arc::new(Session {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            killer: Mutex::new(child.clone_killer()),
            killed: Mutex::new(false),
            pid: child.process_id(),
            started_at: now_ms(),
        });
        let info = RunningInfo {
            id: id.into(),
            pid: session.pid,
            started_at: session.started_at,
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(id.into(), session.clone());

        let (done_tx, done_rx) = mpsc::channel::<()>();
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                pump(reader, on_output);
                let _ = done_tx.send(());
            })
            .map_err(|e| PtyError::Io(e.to_string()))?;

        let sessions = self.sessions.clone();
        let sid = id.to_string();
        std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let code = child.wait().ok().map(|s| s.exit_code());
                drop(session.writer.lock().unwrap().take());
                drop(session.master.lock().unwrap().take());
                let _ = done_rx.recv_timeout(Duration::from_millis(800));
                let killed = *session.killed.lock().unwrap();
                sessions.lock().unwrap().remove(&sid);
                on_exit(ExitInfo { code, killed });
            })
            .map_err(|e| PtyError::Io(e.to_string()))?;

        Ok(info)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let s = self.get(id)?;
        let mut w = s.writer.lock().unwrap();
        let w = w.as_mut().ok_or_else(|| PtyError::NotFound(id.into()))?;
        w.write_all(data)
            .and_then(|_| w.flush())
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let s = self.get(id)?;
        let m = s.master.lock().unwrap();
        let m = m.as_ref().ok_or_else(|| PtyError::NotFound(id.into()))?;
        m.resize(size(cols, rows))
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let s = self.get(id)?;
        *s.killed.lock().unwrap() = true;
        let result = s.killer.lock().unwrap().kill();
        match result {
            Ok(()) => Ok(()),
            Err(e) => {
                drop(s.writer.lock().unwrap().take());
                drop(s.master.lock().unwrap().take());
                match e.raw_os_error() {
                    Some(0) => Ok(()),
                    _ => Err(PtyError::Io(e.to_string())),
                }
            }
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
        for id in ids {
            let _ = self.kill(&id);
        }
    }

    pub fn running(&self) -> Vec<RunningInfo> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .map(|(id, s)| RunningInfo {
                id: id.clone(),
                pid: s.pid,
                started_at: s.started_at,
            })
            .collect()
    }
}

fn pump(mut reader: Box<dyn Read + Send>, on_output: OutputFn) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => on_output(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    struct Probe {
        out: Arc<Mutex<Vec<u8>>>,
        exit: mpsc::Receiver<ExitInfo>,
    }

    fn start(m: &PtyManager, id: &str, program: &str, args: &[&str]) -> Probe {
        let out = Arc::new(Mutex::new(Vec::new()));
        let (tx, exit) = mpsc::channel();
        let o = out.clone();
        m.spawn(
            id,
            LaunchSpec {
                program: program.into(),
                args: args.iter().map(|s| s.to_string()).collect(),
                cwd: None,
                env: vec![("PS1".into(), "$ ".into())],
                cols: 80,
                rows: 24,
            },
            Box::new(move |b| o.lock().unwrap().extend_from_slice(b)),
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
        Probe { out, exit }
    }

    fn wait_for(p: &Probe, needle: &str) {
        for _ in 0..100 {
            if String::from_utf8_lossy(&p.out.lock().unwrap()).contains(needle) {
                return;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        panic!(
            "sortie sans « {needle} » : {:?}",
            String::from_utf8_lossy(&p.out.lock().unwrap())
        );
    }

    #[test]
    fn captures_output_and_exit_code() {
        let m = PtyManager::new();
        let p = start(&m, "a", "/bin/sh", &["-c", "echo bonjour; exit 3"]);
        let e = p.exit.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            e,
            ExitInfo {
                code: Some(3),
                killed: false
            }
        );
        wait_for(&p, "bonjour");
        assert!(!m.is_running("a"));
    }

    #[test]
    fn interactive_input_and_resize() {
        let m = PtyManager::new();
        let p = start(&m, "b", "/bin/sh", &[]);
        m.write("b", b"echo $((40+2))\n").unwrap();
        wait_for(&p, "42");
        m.resize("b", 100, 30).unwrap();
        m.write("b", b"stty size\n").unwrap();
        wait_for(&p, "30 100");
        m.write("b", b"exit 0\n").unwrap();
        assert_eq!(
            p.exit.recv_timeout(Duration::from_secs(5)).unwrap().code,
            Some(0)
        );
    }

    #[test]
    fn kill_reports_killed_and_frees_id() {
        let m = PtyManager::new();
        let p = start(&m, "c", "/bin/sh", &["-c", "sleep 30"]);
        assert!(matches!(
            m.spawn(
                "c",
                LaunchSpec {
                    program: "/bin/true".into(),
                    args: vec![],
                    cwd: None,
                    env: vec![],
                    cols: 80,
                    rows: 24
                },
                Box::new(|_| {}),
                Box::new(|_| {})
            ),
            Err(PtyError::AlreadyRunning(_))
        ));
        m.kill("c").unwrap();
        assert!(p.exit.recv_timeout(Duration::from_secs(5)).unwrap().killed);
        assert!(m.running().is_empty());
        assert!(matches!(m.write("c", b"x"), Err(PtyError::NotFound(_))));
    }

    #[test]
    fn missing_program_or_cwd_is_an_error() {
        let m = PtyManager::new();
        let spec = |program: &str, cwd: Option<&str>| LaunchSpec {
            program: program.into(),
            args: vec![],
            cwd: cwd.map(Into::into),
            env: vec![],
            cols: 80,
            rows: 24,
        };
        assert!(m
            .spawn(
                "d",
                spec("/nope/absent", None),
                Box::new(|_| {}),
                Box::new(|_| {})
            )
            .is_err());
        assert!(m
            .spawn(
                "e",
                spec("/bin/sh", Some("/nope/dir")),
                Box::new(|_| {}),
                Box::new(|_| {})
            )
            .is_err());
        assert!(m.running().is_empty());
    }

    #[test]
    fn massive_output_is_fully_delivered() {
        let m = PtyManager::new();
        let p = start(&m, "f", "/bin/sh", &["-c", "seq 1 50000; echo FIN"]);
        p.exit.recv_timeout(Duration::from_secs(10)).unwrap();
        wait_for(&p, "FIN");
        assert!(String::from_utf8_lossy(&p.out.lock().unwrap()).contains("49999"));
    }
}
