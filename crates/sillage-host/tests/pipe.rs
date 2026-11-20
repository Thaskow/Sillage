#![cfg(windows)]

use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use sillage_host::proto::{encode_json, read_frame, Call, Event, Frame, Reply, Request, Spec};
use sillage_host::{server, HostClient};
use sillage_pty::ExitInfo;

fn test_pipe() -> String {
    format!(r"\\.\pipe\sillage-test-{}", uuid::Uuid::new_v4())
}

fn start_host(name: &str, idle: Duration) -> JoinHandle<std::io::Result<()>> {
    let n = name.to_string();
    std::thread::spawn(move || server::serve(&n, idle))
}

fn open_raw(name: &str) -> tokio::net::windows::named_pipe::NamedPipeClient {
    for _ in 0..50 {
        if let Ok(p) = tokio::net::windows::named_pipe::ClientOptions::new().open(name) {
            return p;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("démon injoignable");
}

fn connect(name: &str) -> HostClient {
    for _ in 0..50 {
        if let Ok(c) = HostClient::connect(name) {
            return c;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("démon injoignable");
}

struct Probe {
    out: Arc<Mutex<Vec<u8>>>,
    exit: mpsc::Receiver<ExitInfo>,
}

fn probe() -> (Probe, sillage_pty::OutputFn, sillage_pty::ExitFn) {
    let out = Arc::new(Mutex::new(Vec::new()));
    let (tx, exit) = mpsc::channel();
    let o = out.clone();
    (
        Probe { out, exit },
        Box::new(move |b| o.lock().unwrap().extend_from_slice(&b)),
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )
}

fn wait_for(p: &Probe, needle: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
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

fn cmd() -> Spec {
    Spec {
        program: "cmd.exe".into(),
        args: vec!["/d".into(), "/q".into()],
        cwd: None,
        env: vec![("SILLAGE_TEST".into(), "marque".into())],
        cols: 100,
        rows: 30,
    }
}

#[test]
fn sessions_survive_client_disconnect_and_replay_scrollback() {
    let name = test_pipe();
    let host = start_host(&name, Duration::from_secs(2));

    let first = connect(&name);
    let (p1, o, e) = probe();
    let info = first.spawn("s1", cmd(), o, e).unwrap();
    assert_eq!(info.id, "s1");
    wait_for(&p1, "[6n");
    first.write("s1", "[1;1R").unwrap();
    first.write("s1", "set /a 40+2\r\n").unwrap();
    wait_for(&p1, "42");
    first.write("s1", "echo %SILLAGE_TEST%-ok\r\n").unwrap();
    wait_for(&p1, "marque-ok");
    drop(first);
    std::thread::sleep(Duration::from_millis(200));

    let second = connect(&name);
    assert!(second.list().unwrap().running.iter().any(|r| r.id == "s1"));
    let (missing, o, e) = probe();
    assert!(second.attach("absent", 80, 24, o, e).unwrap().is_none());
    drop(missing);
    let (p2, o, e) = probe();
    let again = second.attach("s1", 120, 40, o, e).unwrap().unwrap();
    assert_eq!(again.started_at, info.started_at);
    wait_for(&p2, "marque-ok");
    second.write("s1", "set /a 6*7+1\r\n").unwrap();
    wait_for(&p2, "43");
    second.write("s1", "exit 0\r\n").unwrap();
    let ended = p2.exit.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(ended.code, Some(0));
    assert!(!ended.killed);
    let listing = second.list().unwrap();
    assert!(listing.running.is_empty());
    assert!(listing.ended.iter().any(|e| e.id == "s1"));

    let (p3, o, e) = probe();
    second.spawn("s2", cmd(), o, e).unwrap();
    second.kill("s2").unwrap();
    assert!(
        p3.exit
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .killed
    );
    assert!(second.write("s2", "x").is_err());
    assert!(second
        .spawn("../x", cmd(), Box::new(|_| {}), Box::new(|_| {}))
        .is_err());

    drop(second);
    host.join().unwrap().unwrap();
}

#[test]
fn a_second_host_cannot_take_the_name() {
    let name = test_pipe();
    let host = start_host(&name, Duration::from_millis(800));
    let c = connect(&name);
    assert!(server::serve(&name, Duration::from_millis(100)).is_err());
    drop(c);
    host.join().unwrap().unwrap();
}

#[test]
fn protocol_violations_are_refused() {
    use tokio::io::AsyncWriteExt;

    let name = test_pipe();
    let host = start_host(&name, Duration::from_millis(800));
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let mut pipe = open_raw(&name);
        pipe.write_all(&encode_json(&Call {
            seq: 1,
            req: Request::List {},
        }))
        .await
        .unwrap();
        let Some(Frame::Json(b)) = read_frame(&mut pipe, 1 << 20).await.unwrap() else {
            panic!("réponse attendue");
        };
        assert!(matches!(
            serde_json::from_slice::<Event>(&b).unwrap(),
            Event::Reply {
                seq: 1,
                reply: Reply::Error { .. }
            }
        ));
        pipe.write_all(&[3, 0, 0, 0, 0, b'{', b'x']).await.unwrap();
        let closed = tokio::time::timeout(Duration::from_secs(5), read_frame(&mut pipe, 1 << 20))
            .await
            .unwrap();
        assert!(matches!(closed, Ok(None) | Err(_)));

        let mut big = open_raw(&name);
        big.write_all(&u32::MAX.to_le_bytes()).await.unwrap();
        let closed = tokio::time::timeout(Duration::from_secs(5), read_frame(&mut big, 1 << 20))
            .await
            .unwrap();
        assert!(matches!(closed, Ok(None) | Err(_)));
    });
    host.join().unwrap().unwrap();
}

#[test]
fn backend_uses_the_host_and_falls_back_to_local() {
    use sillage_host::Backend;
    use sillage_pty::LaunchSpec;

    let launch = || LaunchSpec {
        program: "cmd.exe".into(),
        args: vec!["/d".into(), "/q".into()],
        cwd: None,
        env: vec![],
        cols: 80,
        rows: 24,
    };
    let name = test_pipe();
    let host = start_host(&name, Duration::from_millis(800));
    connect(&name);
    let n = name.clone();
    let hosted = Backend::with_host(move || HostClient::connect(&n).ok());
    assert!(hosted.hosted());
    let (p, o, e) = probe();
    hosted.spawn("b1", launch(), o, e).unwrap();
    wait_for(&p, "\x1b[6n");
    hosted.write("b1", "\x1b[1;1R").unwrap();
    hosted.write("b1", "echo %PATH:~0,0%hote-ok\r\n").unwrap();
    wait_for(&p, "hote-ok");
    assert!(hosted.is_running("b1"));
    hosted.shutdown();
    assert!(hosted.is_running("b1"));
    hosted.kill("b1").unwrap();
    assert!(p.exit.recv_timeout(Duration::from_secs(10)).unwrap().killed);
    drop(hosted);
    host.join().unwrap().unwrap();

    let local = Backend::with_host(|| None);
    assert!(!local.hosted());
    let (p, o, e) = probe();
    local.spawn("b2", launch(), o, e).unwrap();
    assert!(local
        .attach("b2", 80, 24, Box::new(|_| {}), Box::new(|_| {}))
        .is_err());
    assert!(local.is_running("b2"));
    local.shutdown();
    assert!(p.exit.recv_timeout(Duration::from_secs(10)).unwrap().killed);
}
