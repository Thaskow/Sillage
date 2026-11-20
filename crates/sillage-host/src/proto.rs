use std::io;

use serde::{Deserialize, Serialize};
use sillage_pty::{ExitInfo, RunningInfo};
use tokio::io::{AsyncRead, AsyncReadExt};

pub const PROTOCOL: u32 = 1;
pub const MAX_FROM_CLIENT: usize = 1 << 20;
pub const MAX_FROM_HOST: usize = 4 << 20;

const MAX_ID: usize = 64;
const MAX_WRITE: usize = 256 << 10;
const MAX_ITEMS: usize = 1024;
const MAX_STR: usize = 64 << 10;

const KIND_JSON: u8 = 0;
const KIND_OUTPUT: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Hello { version: u32 },
    Spawn { id: String, spec: Spec },
    Attach { id: String, cols: u16, rows: u16 },
    Write { id: String, data: String },
    Resize { id: String, cols: u16, rows: u16 },
    Kill { id: String },
    List {},
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Call {
    pub seq: u64,
    pub req: Request,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    pub id: String,
    pub info: ExitInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Reply {
    Ok,
    Welcome {
        version: u32,
        pid: u32,
    },
    Started {
        info: RunningInfo,
    },
    Attached {
        info: RunningInfo,
    },
    Missing,
    List {
        running: Vec<RunningInfo>,
        ended: Vec<Ended>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "camelCase")]
pub enum Event {
    Reply { seq: u64, reply: Reply },
    Exit { id: String, info: ExitInfo },
}

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    Json(Vec<u8>),
    Output { id: String, data: Vec<u8> },
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn check_size(cols: u16, rows: u16) -> Result<(), String> {
    if (2..=1000).contains(&cols) && (2..=1000).contains(&rows) {
        Ok(())
    } else {
        Err(format!("taille de terminal invalide : {cols}x{rows}"))
    }
}

fn check_str(s: &str, what: &str) -> Result<(), String> {
    if s.len() > MAX_STR || s.contains('\0') {
        Err(format!("{what} invalide"))
    } else {
        Ok(())
    }
}

impl Spec {
    fn validate(&self) -> Result<(), String> {
        if self.program.trim().is_empty() {
            return Err("programme manquant".into());
        }
        check_str(&self.program, "programme")?;
        if self.args.len() > MAX_ITEMS || self.env.len() > MAX_ITEMS {
            return Err("trop d'arguments ou de variables".into());
        }
        for a in &self.args {
            check_str(a, "argument")?;
        }
        if let Some(c) = &self.cwd {
            check_str(c, "dossier")?;
        }
        for (k, v) in &self.env {
            if k.is_empty() || k.contains('=') {
                return Err("nom de variable invalide".into());
            }
            check_str(k, "variable")?;
            check_str(v, "variable")?;
        }
        check_size(self.cols, self.rows)
    }
}

impl Request {
    pub fn validate(&self) -> Result<(), String> {
        let id = match self {
            Request::Hello { .. } | Request::List {} => return Ok(()),
            Request::Spawn { id, spec } => {
                spec.validate()?;
                id
            }
            Request::Attach { id, cols, rows } | Request::Resize { id, cols, rows } => {
                check_size(*cols, *rows)?;
                id
            }
            Request::Write { id, data } => {
                if data.len() > MAX_WRITE {
                    return Err("saisie trop longue".into());
                }
                id
            }
            Request::Kill { id } => id,
        };
        if valid_id(id) {
            Ok(())
        } else {
            Err("identifiant de session invalide".into())
        }
    }
}

fn header(len: usize, kind: u8) -> Vec<u8> {
    let mut f = Vec::with_capacity(5 + len);
    f.extend_from_slice(&((len + 1) as u32).to_le_bytes());
    f.push(kind);
    f
}

pub fn encode_json<T: Serialize>(v: &T) -> Vec<u8> {
    let body = serde_json::to_vec(v).expect("message sérialisable");
    let mut f = header(body.len(), KIND_JSON);
    f.extend_from_slice(&body);
    f
}

pub fn encode_output(id: &str, data: &[u8]) -> Vec<u8> {
    let mut f = header(1 + id.len() + data.len(), KIND_OUTPUT);
    f.push(id.len() as u8);
    f.extend_from_slice(id.as_bytes());
    f.extend_from_slice(data);
    f
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R, max: usize) -> io::Result<Option<Frame>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len == 0 || len > max {
        return Err(invalid("taille de trame invalide"));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    let body = buf.split_off(1);
    match buf[0] {
        KIND_JSON => Ok(Some(Frame::Json(body))),
        KIND_OUTPUT => {
            let n = *body.first().ok_or_else(|| invalid("trame vide"))? as usize;
            if body.len() < 1 + n {
                return Err(invalid("trame tronquée"));
            }
            let id = std::str::from_utf8(&body[1..1 + n])
                .ok()
                .filter(|id| valid_id(id))
                .ok_or_else(|| invalid("identifiant invalide"))?
                .to_string();
            Ok(Some(Frame::Output {
                id,
                data: body[1 + n..].to_vec(),
            }))
        }
        _ => Err(invalid("type de trame inconnu")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> Spec {
        Spec {
            program: "cmd.exe".into(),
            args: vec!["/c".into(), "echo".into()],
            cwd: None,
            env: vec![("A".into(), "1".into())],
            cols: 80,
            rows: 24,
        }
    }

    async fn decode(bytes: &[u8], max: usize) -> io::Result<Option<Frame>> {
        let mut r = bytes;
        read_frame(&mut r, max).await
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(f)
    }

    #[test]
    fn frames_round_trip() {
        block(async {
            let call = Call {
                seq: 7,
                req: Request::Spawn {
                    id: "a-1".into(),
                    spec: spec(),
                },
            };
            let Some(Frame::Json(b)) = decode(&encode_json(&call), MAX_FROM_CLIENT).await.unwrap()
            else {
                panic!("trame JSON attendue");
            };
            assert_eq!(serde_json::from_slice::<Call>(&b).unwrap(), call);
            assert_eq!(
                decode(&encode_output("s1", b"\x1b[0mok"), MAX_FROM_HOST)
                    .await
                    .unwrap(),
                Some(Frame::Output {
                    id: "s1".into(),
                    data: b"\x1b[0mok".to_vec()
                })
            );
            assert_eq!(decode(b"", MAX_FROM_HOST).await.unwrap(), None);
        });
    }

    #[test]
    fn malformed_frames_are_rejected() {
        block(async {
            assert!(decode(&0u32.to_le_bytes(), 10).await.is_err());
            assert!(decode(&100u32.to_le_bytes(), 10).await.is_err());
            assert!(decode(&[2, 0, 0, 0, 9, 0], 10).await.is_err());
            assert!(decode(&[3, 0, 0, 0, 1, 5, b'a'], 10).await.is_err());
            assert!(decode(&[4, 0, 0, 0, 1, 2, b'a', b'/'], 10).await.is_err());
            assert!(decode(&[9, 0, 0, 0, 0, b'{'], 100).await.is_err());
        });
    }

    #[test]
    fn unknown_fields_and_ops_are_rejected() {
        for bad in [
            r#"{"seq":1,"req":{"op":"list","x":1}}"#,
            r#"{"seq":1,"req":{"op":"format"}}"#,
            r#"{"seq":1,"req":{"op":"kill"}}"#,
            r#"{"seq":1,"req":{"op":"list"},"extra":true}"#,
        ] {
            assert!(serde_json::from_str::<Call>(bad).is_err(), "{bad}");
        }
        assert!(serde_json::from_str::<Call>(r#"{"seq":1,"req":{"op":"list"}}"#).is_ok());
    }

    #[test]
    fn requests_are_validated() {
        let ok = Request::Spawn {
            id: "abc".into(),
            spec: spec(),
        };
        assert!(ok.validate().is_ok());
        let with = |f: &dyn Fn(&mut Spec)| {
            let mut s = spec();
            f(&mut s);
            Request::Spawn {
                id: "abc".into(),
                spec: s,
            }
            .validate()
        };
        assert!(with(&|s| s.program = " ".into()).is_err());
        assert!(with(&|s| s.args.push("a\0b".into())).is_err());
        assert!(with(&|s| s.env.push(("A=B".into(), "x".into()))).is_err());
        assert!(with(&|s| s.cols = 0).is_err());
        assert!(with(&|s| s.args = vec![String::new(); 1100]).is_err());
        for id in ["", "../x", "a b", &"x".repeat(65)] {
            assert!(Request::Kill { id: id.into() }.validate().is_err(), "{id}");
        }
        assert!(Request::Write {
            id: "a".into(),
            data: "x".repeat(MAX_WRITE + 1)
        }
        .validate()
        .is_err());
        assert!(Request::Resize {
            id: "a".into(),
            cols: 80,
            rows: 1
        }
        .validate()
        .is_err());
    }
}
