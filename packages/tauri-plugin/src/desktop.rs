use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Wdio<R>> {
    Ok(Wdio {
        _phantom: std::marker::PhantomData,
    })
}

/// Access to the wdio APIs.
pub struct Wdio<R: Runtime> {
    _phantom: std::marker::PhantomData<R>,
}

// Wdio is Send + Sync regardless of R because it only contains PhantomData
unsafe impl<R: Runtime> Send for Wdio<R> {}
unsafe impl<R: Runtime> Sync for Wdio<R> {}

impl<R: Runtime> Wdio<R> {
    // Add desktop-specific methods here
}

