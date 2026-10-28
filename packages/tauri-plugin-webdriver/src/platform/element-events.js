// biome-ignore-all lint/correctness/noUnusedVariables: the Rust drivers paste this file into page scripts that call its functions
// Page-side helpers for the embedded drivers' element commands: the focus moves and form events
// a user's input causes in a browser. A published crate can only include its own files, so
// tauri-plugin-wdio-webdriver and wdio-dioxus-embedded-driver each keep an identical copy;
// test/scripts/element-events.spec.ts tests it and checks the copies match.

const WDIO_CLEARABLE_INPUT_TYPES = [
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'range',
  'color',
  'file',
];

const WDIO_VALUE_CONTROL_TYPES = ['color', 'date', 'datetime-local', 'month', 'range', 'time', 'week'];

// The focused element, looking through open shadow roots.
function wdioDeepActiveElement() {
  let el = document.activeElement || document.body;
  while (el.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

// Records that `el` owes a `change` once it loses focus, unless its value is `value` again by then.
// An earlier record for `el` wins, as it holds the value from before the first edit.
function wdioRecordPendingChange(el, value) {
  if (window.__wdio_pending_change?.el === el) {
    return;
  }
  wdioTakePendingChange();
  const root = el.getRootNode();
  // Capturing on the field's root runs before the field's own blur listeners, so `change` precedes
  // `blur` however focus leaves, as in a browser.
  const onBlur = (event) => {
    const record = event.target === el && wdioTakePendingChange(el);
    if (record && el.value !== record.value) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  root.addEventListener('blur', onBlur, true);
  window.__wdio_pending_change = { el, value, root, onBlur };
}

// Removes and returns the pending change, or only `el`'s when `el` is given.
function wdioTakePendingChange(el) {
  const record = window.__wdio_pending_change;
  if (!record || (el && record.el !== el)) {
    return undefined;
  }
  record.root.removeEventListener('blur', record.onBlur, true);
  window.__wdio_pending_change = undefined;
  return record;
}

// Enter in an input commits its value, so the field fires the `change` it owes and then owes none.
function wdioCommitOnEnter(el) {
  const record = window.__wdio_pending_change;
  if (el.tagName !== 'INPUT' || record?.el !== el || el.value === record.value) {
    return;
  }
  // The committed value is updated before the dispatch, so a handler that blurs the field doesn't
  // fire a second `change`, and again after, so a value the handler sets doesn't either.
  record.value = el.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  record.value = el.value;
}

// Moves focus as a mousedown on `el` does: to `el` or its nearest focusable ancestor, or off the
// focused element when there is none. A label's click then focuses its control itself.
function wdioFocusForClick(el) {
  for (let node = el; node && node !== document.body; node = node.parentNode || node.host) {
    if (typeof node.focus !== 'function') {
      continue;
    }
    node.focus({ preventScroll: true });
    // `activeElement` reports a shadow host when focus is anywhere in its tree; that only counts as
    // the host taking focus when it delegates focus.
    if (
      node.getRootNode().activeElement === node &&
      (!node.shadowRoot?.activeElement || node.shadowRoot.delegatesFocus)
    ) {
      return;
    }
  }
  const active = wdioDeepActiveElement();
  if (active !== document.body) {
    active.blur();
  }
}

// Element Clear (W3C): returns 'not editable', 'empty' (leaving the element alone) or 'cleared'.
// Clearing fires `change` only if the value differs from its last committed one.
function wdioClearElement(el) {
  const field = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && WDIO_CLEARABLE_INPUT_TYPES.includes(el.type));
  if (field ? el.readOnly || el.matches(':disabled') : !el.isContentEditable) {
    return 'not editable';
  }
  if (field ? el.value === '' : el.innerHTML === '') {
    return 'empty';
  }
  el.focus();
  const record = wdioTakePendingChange(el);
  const committedValue = record ? record.value : el.value;
  if (field) {
    const prototype = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, '');
  } else {
    el.innerHTML = '';
  }
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, composed: true, inputType: 'deleteContentBackward' }),
  );
  if (field && el.value !== committedValue) {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  el.blur();
  return 'cleared';
}

// Send Keys to a date, colour, range or similar input sets its value outright (W3C) and fires
// `input` and `change` at once, as a browser does when the user commits a value. Returns undefined
// for any other element or empty `typed`, and otherwise 'immutable', 'invalid' or 'set'.
function wdioSetValueControl(el, typed) {
  if (el.tagName !== 'INPUT' || !WDIO_VALUE_CONTROL_TYPES.includes(el.type) || typed === '') {
    return undefined;
  }
  if (el.readOnly || el.disabled) {
    return 'immutable';
  }
  el.focus();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const previousValue = el.value;
  setValue.call(el, typed);
  if (el.value === '') {
    setValue.call(el, previousValue);
    return 'invalid';
  }
  if (el.value !== previousValue) {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return 'set';
}
