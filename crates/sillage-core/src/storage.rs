use std::path::{Path, PathBuf};

use rusqlite::{Connection, ErrorCode};
use serde::Serialize;

use crate::{now_ms, Result};

const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    provider TEXT NOT NULL,
    config_dir TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    default_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    layout TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    cwd TEXT,
    command TEXT,
    args TEXT NOT NULL DEFAULT '[]',
    persistent INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER
);
CREATE INDEX sessions_group ON sessions(group_id, position);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#,
    r#"
ALTER TABLE profiles ADD COLUMN share_config INTEGER NOT NULL DEFAULT 1;
"#,
    r#"
ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN agent_started_at INTEGER;
ALTER TABLE sessions ADD COLUMN resume INTEGER NOT NULL DEFAULT 0;
"#,
    r#"
CREATE TABLE history_conversations (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    tool TEXT NOT NULL,
    source_dir TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT,
    title TEXT NOT NULL,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    messages INTEGER NOT NULL
);
CREATE INDEX history_updated ON history_conversations(updated_at DESC);
CREATE VIRTUAL TABLE history_fts USING fts5(
    title, body, tokenize = 'unicode61 remove_diacritics 2'
);
"#,
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpenOutcome {
    Ok,
    Created,
    RecoveredFromCorruption { backup: PathBuf },
}

pub struct Store {
    pub(crate) conn: Connection,
}

fn is_corrupt(e: &crate::Error) -> bool {
    matches!(
        e,
        crate::Error::Db(rusqlite::Error::SqliteFailure(f, _))
            if matches!(f.code, ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase)
    )
}

impl Store {
    pub fn open(path: &Path) -> Result<(Self, OpenOutcome)> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let existed = path.exists();
        match Self::try_open(path) {
            Ok(store) => Ok((
                store,
                if existed {
                    OpenOutcome::Ok
                } else {
                    OpenOutcome::Created
                },
            )),
            Err(e) if existed && is_corrupt(&e) => {
                let backup = path.with_extension(format!("corrupt-{}.db", now_ms()));
                std::fs::rename(path, &backup)?;
                for ext in ["db-wal", "db-shm"] {
                    let _ = std::fs::remove_file(path.with_extension(ext));
                }
                Ok((
                    Self::try_open(path)?,
                    OpenOutcome::RecoveredFromCorruption { backup },
                ))
            }
            Err(e) => Err(e),
        }
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn try_open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(crate::Error::Db(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
                Some(format!("intégrité : {check}")),
            )));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        let mut store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let current = self.schema_version()?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as u32)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<usize> {
        let v: u32 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        Ok(v as usize)
    }

    pub fn latest_schema_version() -> usize {
        MIGRATIONS.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_fresh_database() {
        let s = Store::open_in_memory().unwrap();
        assert_eq!(s.schema_version().unwrap(), Store::latest_schema_version());
    }

    #[test]
    fn reopen_keeps_data_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sillage.db");
        let (s, outcome) = Store::open(&path).unwrap();
        assert_eq!(outcome, OpenOutcome::Created);
        s.conn
            .execute("INSERT INTO settings VALUES ('k','v')", [])
            .unwrap();
        drop(s);
        let (s, outcome) = Store::open(&path).unwrap();
        assert_eq!(outcome, OpenOutcome::Ok);
        let v: String = s
            .conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "v");
    }

    #[test]
    fn corrupt_file_is_set_aside_not_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sillage.db");
        std::fs::write(&path, vec![0x5a_u8; 4096]).unwrap();
        let (s, outcome) = Store::open(&path).unwrap();
        let OpenOutcome::RecoveredFromCorruption { backup } = outcome else {
            panic!("{outcome:?}")
        };
        assert!(backup.exists());
        assert_eq!(s.schema_version().unwrap(), Store::latest_schema_version());
    }

    #[test]
    fn failing_migration_keeps_the_database_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sillage.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE categories (x TEXT);")
            .unwrap();
        assert!(Store::open(&path).is_err());
        assert!(path.exists());
        assert!(!std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().contains("corrupt")));
    }
}
