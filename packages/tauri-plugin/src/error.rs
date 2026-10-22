use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("Execute error: {0}")]
    ExecuteError(String),

    #[error("Mock error: {0}")]
    MockError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Window error: {0}")]
    WindowError(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
