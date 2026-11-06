// Runs in the page on a browser.tauri.execute() result, so it follows JSON, as on the embedded provider and the
// plugin's IPC, apart from DOM nodes and the lists that hold them, which are left for the driver to turn into
// references. The rules are script-result-refs.js's, which the embedded drivers use, and
// test/scripts/script-result-refs.spec.ts checks this gives the same results.
export const RESULT_AS_JSON_JS = `function __wdio_asJson(value) {
  var nodes = [];
  var mark = '__wdio_node_' + Math.random().toString(36).slice(2);
  function isNode(item) {
    // Chromium's <embed> and <object> elements are callable, so their typeof is 'function'
    if (item === null || (typeof item !== 'object' && typeof item !== 'function')) return false;
    return item.nodeType === 1 || (item.nodeType === 11 && !!item.host);
  }
  function listOf(item) {
    if (item === null || typeof item !== 'object' || Array.isArray(item) || typeof item.nodeType === 'number') return undefined;
    if (typeof item[Symbol.iterator] !== 'function' || typeof item.length !== 'number') return undefined;
    return Array.from({ length: item.length }, function (_, i) { return item[i]; });
  }
  var json;
  try {
    json = JSON.stringify(value, function (_key, item) {
      if (isNode(item)) {
        var placeholder = {};
        placeholder[mark] = nodes.push(item) - 1;
        return placeholder;
      }
      var list = listOf(item);
      return list === undefined ? item : list;
    });
  } catch (e) {
    // A result JSON rejects, such as a cycle, goes to the driver as it is, which reports it
    return value;
  }
  if (json === undefined) return null;
  return JSON.parse(json, function (_key, item) {
    return item !== null && typeof item === 'object' && typeof item[mark] === 'number' ? nodes[item[mark]] : item;
  });
}`;
