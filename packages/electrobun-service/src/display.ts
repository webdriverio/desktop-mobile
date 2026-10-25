// Electrobun's WebKitGTK app needs X11: under a headless Weston, which WebdriverIO v10 can start, it never comes up.

/** Whether a process the launcher spawns needs its own X display (`xvfb-run`): on Linux, unless one is set. */
export function needsOwnDisplay(env: NodeJS.ProcessEnv): boolean {
  return process.platform === 'linux' && !env.DISPLAY;
}

/** `env` restricted to X11, so a Wayland session can't pull GTK off the X display. */
export function x11Env(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { WAYLAND_DISPLAY: _waylandDisplay, ...rest } = env;
  return { ...rest, GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' };
}
