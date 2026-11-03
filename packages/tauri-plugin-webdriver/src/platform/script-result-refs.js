// biome-ignore-all lint/correctness/noUnusedVariables: the Rust drivers put this file in each script that returns a result
// Turns the DOM elements and shadow roots in a script result into W3C references, as chromedriver
// does. A published crate can only include its own files, so tauri-plugin-wdio-webdriver and
// wdio-dioxus-embedded-driver each keep an identical copy. test/scripts/script-result-refs.spec.ts
// tests it and checks the copies match.

// Each node is kept on `window` under `varPrefix` and its ID without hyphens, where the driver's
// element commands look it up. IDs are `idPrefix-0`, `idPrefix-1`, and so on.
function __wdioScriptResultRefs(idPrefix, varPrefix) {
  let count = 0;

  // The reference for a DOM element or shadow root, or undefined for any other value.
  function nodeRef(value) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    let key;
    if (value.nodeType === 1) {
      key = 'element-6066-11e4-a52e-4f735466cecf';
    } else if (value.nodeType === 11 && value.host) {
      key = 'shadow-6066-11e4-a52e-4f735466cecf';
    } else {
      return undefined;
    }
    const id = `${idPrefix}-${count++}`;
    window[varPrefix + id.replace(/-/g, '')] = value;
    return { [key]: id };
  }

  // The value as JSON.stringify sends it, with a reference for each node in place of `{}`. A value
  // JSON.stringify rejects, such as a cycle, comes back as it is, to fail as it would without this.
  function withRefs(value) {
    let found = false;
    let json;
    try {
      json = JSON.stringify(value, (_key, item) => {
        const ref = nodeRef(item);
        if (ref === undefined) {
          return item;
        }
        found = true;
        return ref;
      });
    } catch {
      return value;
    }
    return found ? JSON.parse(json) : value;
  }

  return { nodeRef, withRefs };
}
