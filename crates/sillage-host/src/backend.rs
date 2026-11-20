use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sillage_pty::{ExitFn, LaunchSpec, OutputFn, PtyError, PtyManager, Result, RunningInfo};

use crate::client::{HostClient, HostError};
use crate::proto::{Ended, Spec};

const RETRY: Duration = Duration::from_secs(15);

type Connect = Box<dyn Fn() -> Option<HostClient> + Send + Sync>;

/// Terminals live in `sillage-host` when it answers, in-process otherwise.
pub struct Backend {
    local: PtyManager,
    host: Mutex<Option<HostClient>>,
    connect: Option<Connect>,
    last_try: Mutex<Instant>,
}

fn host_err(e: HostError) -> PtyError {
    PtyError::Host(e.to_string())
}

type SharedOut = Arc<Mutex<OutputFn>>;
type SharedExit = Arc<Mutex<Option<ExitFn>>>;

fn shared(out: OutputFn, exit: ExitFn) -> (SharedOut, SharedExit) {
    (Arc::new(Mutex::new(out)), Arc::new(Mutex::new(Some(exit))))
}

fn split(out: &SharedOut, exit: &SharedExit) -> (OutputFn, ExitFn) {
    let out = out.clone();
    let exit = exit.clone();
    (
        Box::new(move |b| (out.lock().unwrap())(b)),
        Box::new(move |e| {
            if let Some(f) = exit.lock().unwrap().take() {
                f(e);
            }
        }),
    )
}

/// The host outlives the app: send the app's environment so new sessions see its current state.
fn current_env() -> impl Iterator<Item = (String, String)> {
    std::env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
}

impl Backend {
    pub fn local() -> Self {
        Self {
            local: PtyManager::new(),
            host: Mutex::new(None),
            connect: None,
            last_try: Mutex::new(Instant::now()),
        }
    }

    pub fn with_host(connect: impl Fn() -> Option<HostClient> + Send + Sync + 'static) -> Self {
        let host = connect();
        Self {
            local: PtyManager::new(),
            host: Mutex::new(host),
            connect: Some(Box::new(connect)),
            last_try: Mutex::new(Instant::now()),
        }
    }

    pub fn hosted(&self) -> bool {
        self.host
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|h| h.is_alive())
    }

    fn host(&self) -> Option<HostClient> {
        let mut slot = self.host.lock().unwrap();
        if let Some(h) = slot.as_ref().filter(|h| h.is_alive()) {
            return Some(h.clone());
        }
        let connect = self.connect.as_ref()?;
        let mut last = self.last_try.lock().unwrap();
        if last.elapsed() < RETRY {
            return None;
        }
        *last = Instant::now();
        *slot = connect();
        slot.clone()
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.local.is_running(id) || self.running_in_host().iter().any(|r| r.id == id)
    }

    fn running_in_host(&self) -> Vec<RunningInfo> {
        self.host()
            .and_then(|h| h.list().ok())
            .map(|l| l.running)
            .unwrap_or_default()
    }

    pub fn spawn(
        &self,
        id: &str,
        spec: LaunchSpec,
        on_output: OutputFn,
        on_exit: ExitFn,
    ) -> Result<RunningInfo> {
        let Some(h) = self.host() else {
            return self.local.spawn(id, spec, on_output, on_exit);
        };
        if self.local.is_running(id) {
            return Err(PtyError::AlreadyRunning(id.into()));
        }
        let (out, exit) = shared(on_output, on_exit);
        let (o, e) = split(&out, &exit);
        let remote = Spec {
            program: spec.program.to_string_lossy().into_owned(),
            args: spec.args.clone(),
            cwd: spec.cwd.as_ref().map(|c| c.to_string_lossy().into_owned()),
            env: current_env().chain(spec.env.iter().cloned()).collect(),
            cols: spec.cols,
            rows: spec.rows,
        };
        match h.spawn(id, remote, o, e) {
            Ok(info) => Ok(info),
            Err(HostError::Unavailable) => {
                let (o, e) = split(&out, &exit);
                self.local.spawn(id, spec, o, e)
            }
            Err(e) => Err(host_err(e)),
        }
    }

    pub fn attach(
        &self,
        id: &str,
        cols: u16,
        rows: u16,
        on_output: OutputFn,
        on_exit: ExitFn,
    ) -> Result<Option<RunningInfo>> {
        if self.local.is_running(id) {
            return Err(PtyError::AlreadyRunning(id.into()));
        }
        match self.host() {
            Some(h) => h
                .attach(id, cols, rows, on_output, on_exit)
                .or_else(|e| match e {
                    HostError::Unavailable => Ok(None),
                    e => Err(host_err(e)),
                }),
            None => Ok(None),
        }
    }

    fn remote(&self, id: &str) -> Result<HostClient> {
        self.host().ok_or_else(|| PtyError::NotFound(id.into()))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        if self.local.is_running(id) {
            return self.local.write(id, data.as_bytes());
        }
        self.remote(id)?.write(id, data).map_err(host_err)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        if self.local.is_running(id) {
            return self.local.resize(id, cols, rows);
        }
        self.remote(id)?.resize(id, cols, rows).map_err(host_err)
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        if self.local.is_running(id) {
            return self.local.kill(id);
        }
        self.remote(id)?.kill(id).map_err(host_err)
    }

    pub fn running(&self) -> Vec<RunningInfo> {
        let mut all = self.local.running();
        all.extend(self.running_in_host());
        all
    }

    pub fn ended(&self) -> Vec<Ended> {
        self.host()
            .and_then(|h| h.list().ok())
            .map(|l| l.ended)
            .unwrap_or_default()
    }

    /// In-process terminals stop with the app; hosted ones are only detached.
    pub fn shutdown(&self) {
        self.local.kill_all();
    }
}
