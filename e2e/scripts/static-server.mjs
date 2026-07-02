#!/usr/bin/env node
// Standalone static file server for the browser-mode E2E fixtures.
//
// Spawned by wdio.dioxus-browser.conf.ts via the service-managed `devServer` option (#417) —
// `devServer: 'node .../static-server.mjs <root> <port>'` — so the *launcher* owns start /
// readiness / teardown instead of the conf's onPrepare/onComplete. This dogfoods the real spawn +
// process-group teardown path. Mirrors the CodeQL-safe file-map the confs served in-process:
// files are enumerated up front and looked up by request path, keeping user input out of readFileSync.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const rootPath = process.argv[2];
const port = Number(process.argv[3] ?? 8088);

if (!rootPath || !existsSync(rootPath)) {
  console.error(`static-server: fixture root not found: ${rootPath}`);
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const allowed = new Map();
const walk = (dir, prefix) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(abs, rel);
    } else if (entry.isFile()) {
      allowed.set(`/${rel}`, abs);
      if (rel === 'index.html') allowed.set('/', abs);
    }
  }
};
walk(rootPath, '');

const server = createServer((req, res) => {
  const key = (req.url ?? '/').split('?')[0];
  const absolute = allowed.get(key);
  if (!absolute) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  res.setHeader('Content-Type', mimeTypes[extname(absolute)] ?? 'application/octet-stream');
  res.end(readFileSync(absolute));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`static-server listening on http://localhost:${port} (root: ${rootPath})`);
});
