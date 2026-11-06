// Runs in the page on the script's result, by the embedded drivers' rules in script-result-refs.js
// (test/scripts/script-result-refs.spec.ts checks they match). Elements and shadow roots become placeholders
// and indexed lists such as a NodeList become arrays; a result with neither, or one JSON.stringify rejects,
// comes back unchanged. Each node goes on `window[stash]` once, so the session's reply never repeats one.
export const STASH_NODES_JS = `function __wdioStashNodes(value, stash, mark) {
  var nodes = [];
  var indexes = new Map();
  var replaced = false;
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
        replaced = true;
        if (!indexes.has(item)) indexes.set(item, nodes.push(item) - 1);
        var placeholder = {};
        placeholder[mark] = indexes.get(item);
        return placeholder;
      }
      var list = listOf(item);
      if (list === undefined) return item;
      replaced = true;
      return list;
    });
  } catch (e) {
    return value;
  }
  if (!replaced) return value;
  var converted = JSON.parse(json);
  if (nodes.length === 0) return converted;
  window[stash] = nodes;
  var envelope = { value: converted };
  envelope[mark] = nodes.length;
  return envelope;
}`;
