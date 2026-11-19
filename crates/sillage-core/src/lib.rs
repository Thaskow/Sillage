pub mod claude_limits;
pub mod error;
pub mod profiles;
pub mod resume;
pub mod sessions;
pub mod settings;
pub mod sharing;
pub mod storage;
pub mod usage;
pub mod workspace;

pub use error::{Error, Result};
pub use storage::{OpenOutcome, Store};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
