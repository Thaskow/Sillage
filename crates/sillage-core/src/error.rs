use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("base locale : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("données invalides : {0}")]
    Json(#[from] serde_json::Error),
    #[error("introuvable : {0}")]
    NotFound(String),
    #[error("valeur invalide : {0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            Error::Db(_) => "db",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
            Error::NotFound(_) => "not_found",
            Error::Invalid(_) => "invalid",
        };
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
