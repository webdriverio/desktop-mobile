/**
 * Merge environment variables, each layer over the ones before it. On Windows variable names ignore case,
 * so a later `Path` replaces an earlier `PATH` rather than sitting beside it, where a child process would
 * pick whichever sorts first.
 */
export function mergeEnv(...layers: Array<Record<string, string | undefined> | undefined>): NodeJS.ProcessEnv {
  // No prototype, so a variable named __proto__ is kept like any other
  const env: NodeJS.ProcessEnv = Object.create(null);
  const keys = new Map<string, string>();
  const ignoreCase = process.platform === 'win32';
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (ignoreCase) {
        // Upper case, as Node folds the names when it builds a child's environment
        const folded = key.toUpperCase();
        const existing = keys.get(folded);
        if (existing !== undefined && existing !== key) {
          delete env[existing];
        }
        keys.set(folded, key);
      }
      env[key] = value;
    }
  }
  return env;
}
