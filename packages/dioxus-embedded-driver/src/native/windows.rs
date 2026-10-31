use std::cell::Cell;
use std::rc::Rc;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use dioxus_desktop::wry::WebViewExtWindows;
use dioxus_desktop::DesktopService;
use webview2_com::CapturePreviewCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

use super::Reply;

pub(super) fn take_screenshot(desktop: &DesktopService, reply: Reply<String>) {
  let webview = desktop.webview.webview();
  // SAFETY: a null HGLOBAL asks COM to allocate and own the backing memory.
  let stream = match unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) } {
    Ok(stream) => stream,
    Err(e) => {
      let _ = reply.send(Err(format!("couldn't create a stream for the screenshot: {e}")));
      return;
    }
  };

  // WebView2 calls the handler later on this thread, or never if
  // CapturePreview fails up front, so both paths share the reply.
  let reply = Rc::new(Cell::new(Some(reply)));
  let handler_reply = Rc::clone(&reply);
  let handler_stream = stream.clone();
  let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
    if let Some(reply) = handler_reply.take() {
      let png = result
        .map_err(|e| format!("CapturePreview failed: {e}"))
        .and_then(|()| read_png_base64(&handler_stream));
      let _ = reply.send(png);
    }
    Ok(())
  }));

  // SAFETY: on the UI thread that owns the webview; the stream and handler
  // are reference-counted COM objects WebView2 retains until it completes.
  let started = unsafe {
    webview.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
  };
  if let Err(e) = started {
    if let Some(reply) = reply.take() {
      let _ = reply.send(Err(format!("CapturePreview failed: {e}")));
    }
  }
}

fn read_png_base64(stream: &IStream) -> Result<String, String> {
  let mut stat = STATSTG::default();
  // SAFETY: `stat` is a valid out-pointer and `buffer` is sized to the
  // stream length reported by Stat.
  unsafe {
    stream
      .Stat(&mut stat, STATFLAG_NONAME)
      .map_err(|e| format!("couldn't size the screenshot stream: {e}"))?;
    let size = usize::try_from(stat.cbSize).map_err(|_| "screenshot is too large".to_string())?;
    if size == 0 {
      return Err("WebView2 returned an empty screenshot".to_string());
    }
    stream
      .Seek(0, STREAM_SEEK_SET, None)
      .map_err(|e| format!("couldn't rewind the screenshot stream: {e}"))?;
    let mut buffer = vec![0u8; size];
    let mut read = 0u32;
    let capacity = u32::try_from(size).map_err(|_| "screenshot is too large".to_string())?;
    stream
      .Read(buffer.as_mut_ptr().cast(), capacity, Some(&mut read))
      .ok()
      .map_err(|e| format!("couldn't read the screenshot stream: {e}"))?;
    buffer.truncate(read as usize);
    Ok(BASE64_STANDARD.encode(buffer))
  }
}
