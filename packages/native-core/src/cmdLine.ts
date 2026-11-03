// Kept out of index.ts: internal to DriverProcess, not package API

// Without cmd.exe to strip them, quotes a caller put around a path would reach the driver as part of it
export function unquote(arg: string): string {
  return arg.length > 1 && arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg;
}

export function quoteForCmd(arg: string): string {
  const bare = unquote(arg);
  if (!/[\s&()<>^|]/.test(bare)) {
    return bare;
  }
  return `"${bare}"`;
}

// On Windows only a .exe or .com starts without cmd.exe; a .cmd shim, or a bare name cmd.exe resolves, needs it
export function needsShell(driverPath: string): boolean {
  return process.platform === 'win32' && !/\.(exe|com)$/i.test(unquote(driverPath));
}
