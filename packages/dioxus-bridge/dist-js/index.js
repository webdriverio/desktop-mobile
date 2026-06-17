// guest-js/index.ts
async function invoke(command, args) {
  const url = window.__WDIO_BRIDGE_URL__ ?? "wdio://invoke";
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ command, args: args ?? null })
  });
  const body = await response.json();
  if (body.ok) {
    return body.value;
  }
  throw new Error(body.error ?? "wdio:// invoke failed with no error message");
}
if (!window.__WDIO_DIOXUS__) {
  window.__WDIO_DIOXUS__ = {};
}
window.__WDIO_DIOXUS__.invoke = invoke;
function wrapConsoleMethod(method, level) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    original(...args);
    const message = args.map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(" ");
    void invoke("log_frontend", { level, message }).catch(() => {
    });
  };
}
var CONSOLE_INSTALLED_KEY = "__WDIO_DIOXUS_CONSOLE_INSTALLED__";
if (!window[CONSOLE_INSTALLED_KEY]) {
  wrapConsoleMethod("log", "info");
  wrapConsoleMethod("info", "info");
  wrapConsoleMethod("warn", "warn");
  wrapConsoleMethod("error", "error");
  wrapConsoleMethod("debug", "debug");
  window[CONSOLE_INSTALLED_KEY] = true;
}
if (typeof window.__WDIO_EMBEDDED_PORT === "number" && !window.__WDIO_EMBEDDED_RUNNING__) {
  window.__WDIO_EMBEDDED_RUNNING__ = true;
  void (async function embeddedDriverLoop() {
    while (true) {
      try {
        const cmd = await invoke("__embedded_poll");
        if (cmd !== null) {
          let result = null;
          let error = null;
          try {
            const AsyncFunction = (async () => {
            }).constructor;
            const fn = new AsyncFunction(...cmd.args.map((_, i) => `__arg${i}`), cmd.script);
            result = await fn(...cmd.args);
          } catch (e) {
            error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          }
          try {
            await invoke("__embedded_result", { id: cmd.id, result: result ?? null, error });
          } catch {
            try {
              await invoke("__embedded_result", {
                id: cmd.id,
                result: null,
                error: "IPC error during result delivery"
              });
            } catch {
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 10));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  })();
}
export {
  invoke
};
