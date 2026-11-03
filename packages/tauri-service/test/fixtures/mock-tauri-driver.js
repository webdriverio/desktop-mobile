#!/usr/bin/env node
/**
 * Mock tauri-driver for integration testing
 * Simulates successful driver startup and graceful shutdown
 */

const fs = require('node:fs');
const http = require('node:http');

if (process.env.WDIO_MOCK_DRIVER_ENV_FILE) {
  fs.writeFileSync(process.env.WDIO_MOCK_DRIVER_ENV_FILE, JSON.stringify(process.env));
}

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const nativePortIndex = args.indexOf('--native-port');
const port = portIndex !== -1 ? args[portIndex + 1] : '4444';
const nativePort = nativePortIndex !== -1 ? args[nativePortIndex + 1] : '4445';

// Create HTTP server to respond to health checks
const server = http.createServer((_req, res) => {
  res.writeHead(200);
  res.end('OK');
});

// Start server then log startup messages
server.listen(parseInt(port, 10), '127.0.0.1', () => {
  console.log(`Starting tauri-driver on port ${port} (native port: ${nativePort})`);
  console.log('tauri-driver started');
  console.log(`Server listening on 127.0.0.1:${port}`);
});

// Log to stderr as well (like real driver)
console.error('[INFO] tauri-driver is running');

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');

  server.close(() => {
    console.log('Server closed');
    console.log('Shutdown complete');
    process.exit(0);
  });
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
