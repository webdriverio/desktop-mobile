/**
 * Whether a process the launcher spawns needs its own display (`xvfb-run`). WebdriverIO v10 starts a display
 * server in the launcher when none exists, and launcher-spawned processes inherit it; v9 only gives one to its
 * workers.
 */
export function needsOwnDisplay(env: NodeJS.ProcessEnv): boolean {
  return process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}
