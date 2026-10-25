// Electrobun's WebKitGTK app needs X11: it never comes up under a headless Weston, which WebdriverIO's display server can start.

/** True on Linux when no X display is set, so the process must run under `xvfb-run`. */
export function needsOwnDisplay(env: NodeJS.ProcessEnv): boolean {
  return process.platform === 'linux' && !env.DISPLAY;
}

/** `env` restricted to X11, so a Wayland session can't pull GTK off the X display. */
export function x11Env(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { WAYLAND_DISPLAY: _waylandDisplay, ...rest } = env;
  return { ...rest, GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' };
}
