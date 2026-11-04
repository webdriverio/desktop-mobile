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
    window[varOf(id)] = value;
    return { [key]: id };
  }

  // Drops the nodes kept for the references numbered `first` and up, which no result will carry.
  function discard(first) {
    for (let n = first; n < count; n++) {
      delete window[varOf(`${idPrefix}-${n}`)];
    }
  }

  // A collection, such as a NodeList, as an array, or undefined. Like chromedriver, it matches any
  // iterable object with a numeric length, from any frame, except nodes: forms and selects are iterable.
  function listOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.nodeType === 'number') {
      return undefined;
    }
    if (typeof value[Symbol.iterator] !== 'function' || typeof value.length !== 'number') {
      return undefined;
    }
    // By index up to `length`, as chromedriver copies it: an iterator that never ends would hang the page.
    return Array.from({ length: value.length }, (_, i) => value[i]);
  }

  // The value as JSON.stringify sends it, with a reference for each node in place of `{}` and an
  // array for each collection. A value JSON.stringify rejects, such as a cycle, comes back as it
  // is, to fail as it would without this, and the nodes kept for it are dropped.
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
