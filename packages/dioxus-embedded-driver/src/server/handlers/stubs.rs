use crate::server::response::{WebDriverErrorResponse, WebDriverResult};

pub async fn not_implemented() -> WebDriverResult {
  Err(WebDriverErrorResponse::unsupported_operation("not implemented for Dioxus embedded driver"))
}
