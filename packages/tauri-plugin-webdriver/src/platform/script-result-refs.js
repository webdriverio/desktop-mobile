// biome-ignore-all lint/correctness/noUnusedVariables: the Rust drivers put this file in each script that returns a result
// Turns the DOM elements and shadow roots in a script result into W3C references, as chromedriver
// does. A published crate can only include its own files, so tauri-plugin-wdio-webdriver and
// wdio-dioxus-embedded-driver each keep an identical copy. test/scripts/script-result-refs.spec.ts
// tests it and checks the copies match.

// Each node is kept on `window` under `varPrefix` and its ID without hyphens, where the driver's
// element commands look it up. IDs are `idPrefix-0`, `idPrefix-1`, and so on.
function __wdioScriptResultRefs(idPrefix, varPrefix) {
  let count = 0;

  function varOf(id) {
    return varPrefix + id.replace(/-/g, '');
  }

  function nodeRef(value) {
    // Chromium's <embed> and <object> elements are callable, so their typeof is 'function'
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
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
    window[varOf(id)] = value;
    return { [key]: id };
  }

  function discard(first) {
    for (let n = first; n < count; n++) {
      delete window[varOf(`${idPrefix}-${n}`)];
    }
  }

  // Chromedriver's test, which also works across frames. Nodes are out: forms and selects are iterable.
  function listOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.nodeType === 'number') {
      return undefined;
    }
    if (typeof value[Symbol.iterator] !== 'function' || typeof value.length !== 'number') {
      return undefined;
    }
    // By index, as chromedriver does: an endless iterator would hang the page.
    return Array.from({ length: value.length }, (_, i) => value[i]);
  }

  // A result JSON.stringify rejects, such as a cycle, comes back as it is, to fail as it did before.
  function withRefs(value) {
    const first = count;
    let replaced = false;
    let json;
    try {
      json = JSON.stringify(value, (_key, item) => {
        const replacement = nodeRef(item) ?? listOf(item);
        if (replacement === undefined) {
          return item;
        }
        replaced = true;
        return replacement;
      });
    } catch {
      discard(first);
      return value;
    }
    return replaced ? JSON.parse(json) : value;
  }

  return { discard, listOf, nodeRef, withRefs };
}
