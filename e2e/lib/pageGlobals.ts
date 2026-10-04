// Shared shapes for reaching into the page/webview realm from `execute()` callbacks.
//
// Import these with `import type`. Two constraints force the pattern:
//   1. The e2e tsconfig `lib` is ES2022 only (no DOM), so `document` isn't a typed
//      global — keeping DOM out is deliberate: these specs' own bodies run in Node,
//      where DOM globals genuinely don't exist.
//   2. `execute()` callbacks are serialized into the page, so a runtime helper
//      would throw there (`pageGlobal is not defined`). A type erases at compile
//      time, leaving a bare `globalThis.document`.
// Hence the cast (`globalThis as unknown as PageWindow`) stays inline at each call
// site; only the shapes live here.

export type PageElement = { id: string; textContent: string | null };
export type PageDocument = { getElementById(id: string): PageElement | null };
export type PageWindow = { document: PageDocument };
