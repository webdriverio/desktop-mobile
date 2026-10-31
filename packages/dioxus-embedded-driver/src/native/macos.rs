use std::cell::Cell;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use block2::RcBlock;
use dioxus_desktop::wry::WebViewExtMacOS;
use dioxus_desktop::DesktopService;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError, NSString};
use objc2_web_kit::WKSnapshotConfiguration;

use super::Reply;

pub(super) fn take_screenshot(desktop: &DesktopService, reply: Reply<String>) {
  let Some(mtm) = MainThreadMarker::new() else {
    let _ = reply.send(Err("screenshot ran off the main thread".to_string()));
    return;
  };
  let webview = desktop.webview.webview();

  let reply = Cell::new(Some(reply));
  let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
    let Some(reply) = reply.take() else {
      return;
    };
    // SAFETY: WebKit passes either a valid image or a valid error, each
    // alive for the duration of this call.
    let result = unsafe {
      match (image.as_ref(), error.as_ref()) {
        (_, Some(error)) => Err(error.localizedDescription().to_string()),
        (Some(image), None) => image_to_png_base64(image),
        (None, None) => Err("WebKit returned no snapshot".to_string()),
      }
    };
    let _ = reply.send(result);
  });

  // SAFETY: on the main thread (checked above), with a live webview.
  unsafe {
    let config = WKSnapshotConfiguration::new(mtm);
    webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &completion);
  }
}

fn image_to_png_base64(image: &NSImage) -> Result<String, String> {
  let tiff = image.TIFFRepresentation().ok_or("snapshot has no TIFF representation")?;
  let bitmap =
    NSBitmapImageRep::imageRepWithData(&tiff).ok_or("snapshot TIFF couldn't be decoded")?;
  let properties = NSDictionary::<NSString>::new();
  // SAFETY: an empty properties dictionary is valid for every file type.
  let png =
    unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties) }
      .ok_or("snapshot couldn't be encoded as PNG")?;
  Ok(BASE64_STANDARD.encode(png.to_vec()))
}
