//! Page focus emulation for `WebView2`.

use dioxus_core::VirtualDom;

/// On Windows, makes `WebView2` treat the page as focused even while its window is in the
/// background, where scripted focus moves otherwise fire no `focus` or `blur`. Elsewhere it does
/// nothing. It runs from `with_on_window`, before Dioxus builds the webview, so the work waits in a
/// task until the window's `DesktopContext` exists.
pub(crate) fn emulate_page_focus(dom: &mut VirtualDom) {
  #[cfg(target_os = "windows")]
  dom.in_scope(dioxus_core::ScopeId::ROOT, || {
    dioxus_core::spawn(async { webview2::emulate_page_focus() });
  });
  #[cfg(not(target_os = "windows"))]
  let _ = dom;
}

#[cfg(target_os = "windows")]
mod webview2 {
  use dioxus_desktop::wry::WebViewExtWindows;
  use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
  use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
  use windows_core::{IUnknown, Interface, HSTRING, PCWSTR};

  pub(super) fn emulate_page_focus() {
    let Some(desktop) = dioxus_core::try_consume_context::<dioxus_desktop::DesktopContext>() else {
      tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: no desktop window");
      return;
    };
    // SAFETY: wry's interface is a #[repr(transparent)] COM pointer, and every COM interface starts
    // with IUnknown, so the bridge needn't match wry's crate versions. QueryInterface then checks it
    // really is an ICoreWebView2.
    let unknown: IUnknown = unsafe { std::mem::transmute(desktop.webview.webview()) };
    let webview = match unknown.cast::<ICoreWebView2>() {
      Ok(webview) => webview,
      Err(e) => {
        tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: {e:?}");
        return;
      }
    };
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|result, json| {
      if let Err(e) = result {
        tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: {e:?} {json}");
      }
      Ok(())
    }));
    let method = HSTRING::from("Emulation.setFocusEmulationEnabled");
    let params = HSTRING::from(r#"{"enabled":true}"#);
    // SAFETY: a COM call on the webview's own UI thread, where Dioxus runs its tasks.
    let result = unsafe {
      webview.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler)
    };
    if let Err(e) = result {
      tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: {e:?}");
    }
  }
}
