//! Page focus emulation for `WebView2`.

use dioxus_core::VirtualDom;

/// On Windows, makes `WebView2` treat the page as focused even while its window is in the
/// background, where scripted focus moves otherwise fire no `focus` or `blur`. Elsewhere it does
/// nothing. Call it from `with_on_window`: Dioxus builds the webview afterwards, so the work runs
/// in a task once the window's `DesktopContext` exists.
#[cfg(target_os = "windows")]
pub fn emulate_page_focus(dom: &mut VirtualDom) {
  dom.in_scope(dioxus_core::ScopeId::ROOT, || {
    dioxus_core::spawn(async { webview2::emulate_page_focus() });
  });
}

#[cfg(not(target_os = "windows"))]
pub fn emulate_page_focus(_dom: &mut VirtualDom) {}

#[cfg(target_os = "windows")]
mod webview2 {
  use dioxus_desktop::wry::WebViewExtWindows;
  use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
  use windows_core::{HSTRING, PCWSTR};

  pub(super) fn emulate_page_focus() {
    let controller = dioxus_desktop::window().webview.controller();
    // SAFETY: COM calls on the webview's own UI thread, where Dioxus runs its tasks.
    let result = unsafe {
      controller.CoreWebView2().and_then(|webview| {
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|result, _| {
          if let Err(e) = result {
            tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: {e:?}");
          }
          Ok(())
        }));
        let method = HSTRING::from("Emulation.setFocusEmulationEnabled");
        let params = HSTRING::from(r#"{"enabled":true}"#);
        webview.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler)
      })
    };
    if let Err(e) = result {
      tracing::error!(target: "wdio_dioxus_bridge", "Failed to turn on focus emulation: {e:?}");
    }
  }
}
