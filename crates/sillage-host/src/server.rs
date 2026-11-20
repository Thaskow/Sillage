use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sillage_pty::{ExitInfo, LaunchSpec, PtyManager};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::proto::{
    encode_json, encode_output, read_frame, Call, Ended, Event, Frame, Reply, Request,
    MAX_FROM_CLIENT, PROTOCOL,
};

pub const SCROLLBACK: usize = 512 << 10;
const MAX_ENDED: usize = 256;

type Tx = mpsc::UnboundedSender<Vec<u8>>;

#[derive(Default)]
struct Scroll(Vec<u8>);

impl Scroll {
    fn push(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
        if self.0.len() > 2 * SCROLLBACK {
            let cut = self.0.len() - SCROLLBACK;
            self.0.drain(..cut);
        }
    }

    fn recent(&self) -> &[u8] {
        &self.0[self.0.len().saturating_sub(SCROLLBACK)..]
    }
}

#[derive(Default)]
struct Live {
    scroll: Scroll,
    subs: HashMap<u64, Tx>,
}

struct State {
    live: HashMap<String, Live>,
    ended: VecDeque<Ended>,
    clients: usize,
    idle_since: Option<Instant>,
}

impl State {
    fn touch(&mut self) {
        self.idle_since = (self.live.is_empty() && self.clients == 0).then(Instant::now);
    }
}

#[derive(Clone)]
pub struct Hub {
    pty: PtyManager,
    state: Arc<Mutex<State>>,
    next_conn: Arc<AtomicU64>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        Self {
            pty: PtyManager::new(),
            state: Arc::new(Mutex::new(State {
                live: HashMap::new(),
                ended: VecDeque::new(),
                clients: 0,
                idle_since: Some(Instant::now()),
            })),
            next_conn: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn idle_for(&self) -> Duration {
        self.state
            .lock()
            .unwrap()
            .idle_since
            .map(|t| t.elapsed())
            .unwrap_or_default()
    }

    pub fn kill_all(&self) {
        self.pty.kill_all();
    }

    fn connect(&self) -> u64 {
        let mut st = self.state.lock().unwrap();
        st.clients += 1;
        st.touch();
        self.next_conn.fetch_add(1, Ordering::Relaxed)
    }

    fn disconnect(&self, conn: u64) {
        let mut st = self.state.lock().unwrap();
        st.clients -= 1;
        for l in st.live.values_mut() {
            l.subs.remove(&conn);
        }
        st.touch();
    }

    fn handle(&self, conn: u64, tx: &Tx, greeted: &mut bool, req: Request) -> Reply {
        if let Err(message) = req.validate() {
            return Reply::Error { message };
        }
        if !*greeted && !matches!(req, Request::Hello { .. }) {
            return Reply::Error {
                message: "poignée de main attendue".into(),
            };
        }
        let done = |r: sillage_pty::Result<()>| match r {
            Ok(()) => Reply::Ok,
            Err(e) => Reply::Error {
                message: e.to_string(),
            },
        };
        match req {
            Request::Hello { .. } => {
                *greeted = true;
                Reply::Welcome {
                    version: PROTOCOL,
                    pid: std::process::id(),
                }
            }
            Request::Spawn { id, spec } => self.spawn(conn, tx, id, spec),
            Request::Attach { id, cols, rows } => self.attach(conn, tx, &id, cols, rows),
            Request::Write { id, data } => done(self.pty.write(&id, data.as_bytes())),
            Request::Resize { id, cols, rows } => done(self.pty.resize(&id, cols, rows)),
            Request::Kill { id } => done(self.pty.kill(&id)),
            Request::List {} => Reply::List {
                running: self.pty.running(),
                ended: self.state.lock().unwrap().ended.iter().cloned().collect(),
            },
        }
    }

    fn spawn(&self, conn: u64, tx: &Tx, id: String, spec: crate::proto::Spec) -> Reply {
        {
            let mut st = self.state.lock().unwrap();
            if st.live.contains_key(&id) {
                return Reply::Error {
                    message: sillage_pty::PtyError::AlreadyRunning(id).to_string(),
                };
            }
            let mut live = Live::default();
            live.subs.insert(conn, tx.clone());
            st.live.insert(id.clone(), live);
            st.ended.retain(|e| e.id != id);
            st.touch();
        }
        let out_state = self.state.clone();
        let out_id = id.clone();
        let exit_state = self.state.clone();
        let exit_id = id.clone();
        let launch = LaunchSpec {
            program: PathBuf::from(spec.program),
            args: spec.args,
            cwd: spec.cwd.map(PathBuf::from),
            env: spec.env,
            cols: spec.cols,
            rows: spec.rows,
        };
        let r = self.pty.spawn(
            &id,
            launch,
            Box::new(move |b| {
                let mut st = out_state.lock().unwrap();
                if let Some(l) = st.live.get_mut(&out_id) {
                    l.scroll.push(&b);
                    let frame = encode_output(&out_id, &b);
                    l.subs.retain(|_, tx| tx.send(frame.clone()).is_ok());
                }
            }),
            Box::new(move |info: ExitInfo| {
                let mut st = exit_state.lock().unwrap();
                let live = st.live.remove(&exit_id);
                let frame = encode_json(&Event::Exit {
                    id: exit_id.clone(),
                    info: info.clone(),
                });
                for tx in live.iter().flat_map(|l| l.subs.values()) {
                    let _ = tx.send(frame.clone());
                }
                st.ended.push_back(Ended { id: exit_id, info });
                while st.ended.len() > MAX_ENDED {
                    st.ended.pop_front();
                }
                st.touch();
            }),
        );
        match r {
            Ok(info) => Reply::Started { info },
            Err(e) => {
                let mut st = self.state.lock().unwrap();
                st.live.remove(&id);
                st.touch();
                Reply::Error {
                    message: e.to_string(),
                }
            }
        }
    }

    fn attach(&self, conn: u64, tx: &Tx, id: &str, cols: u16, rows: u16) -> Reply {
        let Some(info) = self.pty.running().into_iter().find(|r| r.id == id) else {
            return Reply::Missing;
        };
        let _ = self.pty.resize(id, cols, rows);
        let mut st = self.state.lock().unwrap();
        let Some(live) = st.live.get_mut(id) else {
            return Reply::Missing;
        };
        let recent = live.scroll.recent();
        if !recent.is_empty() {
            let _ = tx.send(encode_output(id, recent));
        }
        live.subs.insert(conn, tx.clone());
        Reply::Attached { info }
    }
}

pub async fn serve_conn<S>(hub: Hub, stream: S)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let (mut r, mut w) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let conn = hub.connect();
    let writer = tokio::spawn(async move {
        while let Some(f) = rx.recv().await {
            if w.write_all(&f).await.is_err() {
                break;
            }
        }
    });
    let mut greeted = false;
    while let Ok(Some(Frame::Json(body))) = read_frame(&mut r, MAX_FROM_CLIENT).await {
        let Ok(call) = serde_json::from_slice::<Call>(&body) else {
            break;
        };
        let reply = hub.handle(conn, &tx, &mut greeted, call.req);
        if tx
            .send(encode_json(&Event::Reply {
                seq: call.seq,
                reply,
            }))
            .is_err()
        {
            break;
        }
    }
    hub.disconnect(conn);
    writer.abort();
}

#[cfg(windows)]
pub fn serve(name: &str, idle: Duration) -> std::io::Result<()> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(listen(name, idle))
}

#[cfg(windows)]
async fn listen(name: &str, idle: Duration) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::{PipeMode, ServerOptions};

    let security = crate::security::PipeSecurity::current_user()?;
    let mut opts = ServerOptions::new();
    opts.reject_remote_clients(true)
        .pipe_mode(PipeMode::Byte)
        .max_instances(16);
    let create = |opts: &ServerOptions| unsafe {
        opts.create_with_security_attributes_raw(name, security.as_ptr())
    };
    let mut server = create(opts.clone().first_pipe_instance(true))?;
    let hub = Hub::new();
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    loop {
        tokio::select! {
            r = server.connect() => {
                let next = create(&opts)?;
                let conn = std::mem::replace(&mut server, next);
                if r.is_ok() {
                    tokio::spawn(serve_conn(hub.clone(), conn));
                }
            }
            _ = tick.tick() => {
                if hub.idle_for() >= idle {
                    return Ok(());
                }
            }
        }
    }
}
