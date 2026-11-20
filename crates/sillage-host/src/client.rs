use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::time::Duration;

use sillage_pty::{ExitFn, ExitInfo, OutputFn, RunningInfo};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

use crate::proto::{
    encode_json, read_frame, Call, Ended, Event, Frame, Reply, Request, Spec, MAX_FROM_HOST,
    PROTOCOL,
};

const CALL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub enum HostError {
    Unavailable,
    Refused(String),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostError::Unavailable => f.write_str("le démon Sillage ne répond plus"),
            HostError::Refused(m) => f.write_str(m),
        }
    }
}

pub type HostResult<T> = std::result::Result<T, HostError>;

struct Sink {
    out: OutputFn,
    exit: Option<ExitFn>,
}

#[derive(Default)]
struct Shared {
    pending: Mutex<HashMap<u64, std_mpsc::Sender<Reply>>>,
    sinks: Mutex<HashMap<String, Sink>>,
    alive: AtomicBool,
}

impl Shared {
    fn dispatch(&self, frame: Frame) -> bool {
        match frame {
            Frame::Output { id, data } => {
                if let Some(s) = self.sinks.lock().unwrap().get(&id) {
                    (s.out)(data);
                }
            }
            Frame::Json(body) => match serde_json::from_slice::<Event>(&body) {
                Ok(Event::Reply { seq, reply }) => {
                    if let Some(tx) = self.pending.lock().unwrap().remove(&seq) {
                        let _ = tx.send(reply);
                    }
                }
                Ok(Event::Exit { id, info }) => self.exit(&id, info),
                Err(_) => return false,
            },
        }
        true
    }

    fn exit(&self, id: &str, info: ExitInfo) {
        let sink = self.sinks.lock().unwrap().remove(id);
        if let Some(f) = sink.and_then(|s| s.exit) {
            f(info);
        }
    }

    fn lost(&self) {
        self.alive.store(false, Ordering::SeqCst);
        self.pending.lock().unwrap().clear();
        let ids: Vec<String> = self.sinks.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.exit(
                &id,
                ExitInfo {
                    code: None,
                    killed: false,
                },
            );
        }
    }
}

struct Handle {
    shared: Arc<Shared>,
    tx: mpsc::UnboundedSender<Vec<u8>>,
    seq: AtomicU64,
    close: Mutex<Option<oneshot::Sender<()>>>,
    host_pid: AtomicU64,
}

impl Drop for Handle {
    fn drop(&mut self) {
        if let Some(c) = self.close.lock().unwrap().take() {
            let _ = c.send(());
        }
    }
}

#[derive(Clone)]
pub struct HostClient {
    h: Arc<Handle>,
}

pub struct Listing {
    pub running: Vec<RunningInfo>,
    pub ended: Vec<Ended>,
}

impl HostClient {
    pub fn from_stream<S, F>(open: F) -> io::Result<Self>
    where
        S: AsyncRead + AsyncWrite + Send + 'static,
        F: FnOnce() -> io::Result<S> + Send + 'static,
    {
        let shared = Arc::new(Shared::default());
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (close_tx, close_rx) = oneshot::channel::<()>();
        let (ready_tx, ready_rx) = std_mpsc::channel::<io::Result<()>>();
        let task_shared = shared.clone();
        std::thread::Builder::new()
            .name("sillage-host-client".into())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                rt.block_on(async move {
                    let stream = match open() {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = ready_tx.send(Err(e));
                            return;
                        }
                    };
                    task_shared.alive.store(true, Ordering::SeqCst);
                    let _ = ready_tx.send(Ok(()));
                    let (mut r, mut w) = tokio::io::split(stream);
                    let writer = async {
                        while let Some(f) = rx.recv().await {
                            if w.write_all(&f).await.is_err() {
                                break;
                            }
                        }
                    };
                    let reader = async {
                        while let Ok(Some(f)) = read_frame(&mut r, MAX_FROM_HOST).await {
                            if !task_shared.dispatch(f) {
                                break;
                            }
                        }
                    };
                    let closed = tokio::select! {
                        _ = writer => false,
                        _ = reader => false,
                        _ = close_rx => true,
                    };
                    if closed {
                        task_shared.sinks.lock().unwrap().clear();
                    }
                    task_shared.lost();
                });
            })?;
        ready_rx
            .recv()
            .map_err(|_| io::Error::other("connexion interrompue"))??;
        let client = Self {
            h: Arc::new(Handle {
                shared,
                tx,
                seq: AtomicU64::new(1),
                close: Mutex::new(Some(close_tx)),
                host_pid: AtomicU64::new(0),
            }),
        };
        match client.call(Request::Hello { version: PROTOCOL }) {
            Ok(Reply::Welcome { version, pid }) if version == PROTOCOL => {
                client.h.host_pid.store(pid as u64, Ordering::Relaxed);
                Ok(client)
            }
            Ok(_) => Err(io::Error::other("version du démon incompatible")),
            Err(e) => Err(io::Error::other(e.to_string())),
        }
    }

    #[cfg(windows)]
    pub fn connect(name: &str) -> io::Result<Self> {
        use tokio::net::windows::named_pipe::ClientOptions;

        let name = name.to_string();
        Self::from_stream(move || {
            let pipe = ClientOptions::new().open(&name)?;
            if !crate::security::owned_by_current_user(&pipe)? {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "le canal Sillage appartient à un autre compte",
                ));
            }
            Ok(pipe)
        })
    }

    #[cfg(not(windows))]
    pub fn connect(_name: &str) -> io::Result<Self> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "démon disponible sous Windows uniquement",
        ))
    }

    pub fn is_alive(&self) -> bool {
        self.h.shared.alive.load(Ordering::SeqCst)
    }

    pub fn host_pid(&self) -> u32 {
        self.h.host_pid.load(Ordering::Relaxed) as u32
    }

    fn call(&self, req: Request) -> HostResult<Reply> {
        if !self.is_alive() {
            return Err(HostError::Unavailable);
        }
        let seq = self.h.seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std_mpsc::channel();
        self.h.shared.pending.lock().unwrap().insert(seq, tx);
        if self.h.tx.send(encode_json(&Call { seq, req })).is_err() {
            self.h.shared.pending.lock().unwrap().remove(&seq);
            return Err(HostError::Unavailable);
        }
        let reply = rx.recv_timeout(CALL_TIMEOUT);
        self.h.shared.pending.lock().unwrap().remove(&seq);
        match reply {
            Ok(Reply::Error { message }) => Err(HostError::Refused(message)),
            Ok(r) => Ok(r),
            Err(_) => Err(HostError::Unavailable),
        }
    }

    fn ack(&self, req: Request) -> HostResult<()> {
        self.call(req).map(|_| ())
    }

    fn with_sink(
        &self,
        id: &str,
        out: OutputFn,
        exit: ExitFn,
        req: Request,
    ) -> HostResult<Option<RunningInfo>> {
        self.h.shared.sinks.lock().unwrap().insert(
            id.to_string(),
            Sink {
                out,
                exit: Some(exit),
            },
        );
        let r = self.call(req);
        let info = match &r {
            Ok(Reply::Started { info }) | Ok(Reply::Attached { info }) => Some(info.clone()),
            _ => None,
        };
        if info.is_none() {
            self.h.shared.sinks.lock().unwrap().remove(id);
        }
        r.map(|_| info)
    }

    pub fn spawn(
        &self,
        id: &str,
        spec: Spec,
        out: OutputFn,
        exit: ExitFn,
    ) -> HostResult<RunningInfo> {
        let req = Request::Spawn {
            id: id.into(),
            spec,
        };
        self.with_sink(id, out, exit, req)?
            .ok_or_else(|| HostError::Refused("réponse inattendue du démon".into()))
    }

    pub fn attach(
        &self,
        id: &str,
        cols: u16,
        rows: u16,
        out: OutputFn,
        exit: ExitFn,
    ) -> HostResult<Option<RunningInfo>> {
        let req = Request::Attach {
            id: id.into(),
            cols,
            rows,
        };
        self.with_sink(id, out, exit, req)
    }

    pub fn write(&self, id: &str, data: &str) -> HostResult<()> {
        self.ack(Request::Write {
            id: id.into(),
            data: data.into(),
        })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> HostResult<()> {
        self.ack(Request::Resize {
            id: id.into(),
            cols,
            rows,
        })
    }

    pub fn kill(&self, id: &str) -> HostResult<()> {
        self.ack(Request::Kill { id: id.into() })
    }

    pub fn list(&self) -> HostResult<Listing> {
        match self.call(Request::List {})? {
            Reply::List { running, ended } => Ok(Listing { running, ended }),
            _ => Err(HostError::Refused("réponse inattendue du démon".into())),
        }
    }
}
