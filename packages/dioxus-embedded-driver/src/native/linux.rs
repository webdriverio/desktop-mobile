use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use cairo::{ImageSurface, Surface};
use dioxus_desktop::wry::WebViewExtUnix;
use dioxus_desktop::DesktopService;
use webkit2gtk::glib::MainContext;
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use super::Reply;

pub(super) fn take_screenshot(desktop: &DesktopService, reply: Reply<String>) {
  let webview = desktop.webview.webview();
  MainContext::default().spawn_local(async move {
    let png = match webview.snapshot_future(SnapshotRegion::Visible, SnapshotOptions::NONE).await {
      Ok(surface) => surface_to_png_base64(surface),
      Err(e) => Err(format!("WebKitGTK snapshot failed: {e}")),
    };
    let _ = reply.send(png);
  });
}

fn surface_to_png_base64(surface: Surface) -> Result<String, String> {
  let image =
    ImageSurface::try_from(surface).map_err(|_| "snapshot isn't an image surface".to_string())?;
  let mut png = Vec::new();
  image.write_to_png(&mut png).map_err(|e| format!("couldn't encode the snapshot as PNG: {e}"))?;
  Ok(BASE64_STANDARD.encode(png))
}
