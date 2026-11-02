// Kept out of index.ts: internal to DriverProcess, not package API

// Quotes a caller added around a path, the old workaround for spaces under cmd.exe, would otherwise reach the
// driver as part of the path once cmd.exe isn't there to strip them
export function unquote(arg: string): string {
  return arg.length > 1 && arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
}

// A trailing backslash is doubled so it doesn't escape the closing quote
export function quoteForCmd(arg: string): string {
  const bare = unquote(arg);
  if (bare !== '' && !/[\s"&()<>^|]/.test(bare)) {
    return bare;
  }
  return `"${bare.replace(/"/g, '""').replace(/(\\+)$/, '$1$1')}"`;
}

// On Windows only a .exe or .com starts without cmd.exe; a .cmd shim, or a bare name cmd.exe resolves, needs it
export function needsShell(driverPath: string): boolean {
  return process.platform === 'win32' && !/\.(exe|com)$/i.test(unquote(driverPath));
}
