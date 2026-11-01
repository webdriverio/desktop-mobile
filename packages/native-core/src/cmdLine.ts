// Kept out of index.ts: internal to DriverProcess, not package API

// An argument the caller already quoted is left alone, and a trailing backslash is doubled so it doesn't escape
// the closing quote
export function quoteForCmd(arg: string): string {
  if ((arg.length > 1 && arg.startsWith('"') && arg.endsWith('"')) || !/[\s"&()<>^|]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""').replace(/(\\+)$/, '$1$1')}"`;
}

// On Windows only a .exe or .com starts without cmd.exe; a .cmd shim, or a bare name cmd.exe resolves, needs it
export function needsShell(driverPath: string): boolean {
  return process.platform === 'win32' && !/\.(exe|com)$/i.test(driverPath);
}
