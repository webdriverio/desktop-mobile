#!/usr/bin/env node
/**
 * Mock driver that emits a startup marker but never binds to a port.
 * Used to verify the startupMarker fast-path resolves start() without
 * waiting for the TCP/HTTP poll loop.
 */

// Emit a recognised TAURI_STARTUP_MARKERS string. This is the only signal
// the driver gives that it's "ready" — there's no listening port to poll.
console.log('tauri-driver started');

// Stay alive until killed so the wrapper's start() promise has time to
// resolve and tests can call stop() cleanly.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Keep the event loop busy without consuming CPU.
setInterval(() => {}, 1_000);
