/**
 * Merge environment variables, each layer over the ones before it. On Windows variable names ignore case,
 * so a later `Path` replaces an earlier `PATH` rather than sitting beside it, where a child process would
 * pick whichever sorts first.
 */
export function mergeEnv(...layers: Array<Record<string, string | undefined> | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keys = new Map<string, string>();
  const ignoreCase = process.platform === 'win32';
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (ignoreCase) {
        const existing = keys.get(key.toLowerCase());
        if (existing !== undefined && existing !== key) {
          delete env[existing];
        }
        keys.set(key.toLowerCase(), key);
      }
      env[key] = value;
    }
  }
  return env;
}
