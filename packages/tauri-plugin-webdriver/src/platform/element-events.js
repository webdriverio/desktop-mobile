// biome-ignore-all lint/correctness/noUnusedVariables: the Rust drivers paste this file into page scripts that call its functions
// Page-side helpers for the embedded drivers' element commands: the focus moves and form events
// a user's input causes in a browser. Tested in test/scripts/element-events.spec.ts.

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

const WDIO_CLICK_FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, iframe, summary, audio[controls], video[controls], [tabindex]';

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
  wdioFirePendingChange();
  const root = el.getRootNode();
  // Capturing on the field's root runs before the field's own blur listeners, so `change` precedes
  // `blur` however focus leaves, as in a browser.
  const onBlur = (event) => {
    if (event.target === el) {
      wdioFirePendingChange(el);
    }
  };
  root.addEventListener('blur', onBlur, true);
  window.__wdio_pending_change = { el, value, root, onBlur };
}

// WebView2 skips `blur` on scripted focus moves while its window isn't focused, so the driver
// calls this around its own focus moves, and a field that lost focus without a `blur` fires the
// `change` it owes. Workaround for #886; drop once the drivers emulate focus.
function wdioFlushPendingChange() {
  const record = window.__wdio_pending_change;
  if (record && record.root.activeElement !== record.el) {
    wdioFirePendingChange();
  }
}

function wdioFocus(el) {
  wdioFlushPendingChange();
  el.focus();
  wdioFlushPendingChange();
}

// A field the page has removed fires nothing, as its component may be gone.
function wdioFirePendingChange(el) {
  const record = wdioTakePendingChange(el);
  if (record?.el.isConnected && record.el.value !== record.value) {
    record.el.dispatchEvent(new Event('change', { bubbles: true }));
  }
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

// Element Click's press, as Chrome sends it: a cancelled pointerdown or mousedown keeps focus where
// it is, and a disabled control gets no mouse events. Mouse events have detail 0, because Tauri's
// drag regions start a native window drag on detail 1, which would never end with no button held.
function wdioPress(el) {
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: Math.floor(rect.left + rect.width / 2),
    clientY: Math.floor(rect.top + rect.height / 2),
  };
  const pressed = el.dispatchEvent(
    new PointerEvent('pointerdown', { ...wdioPointer(init), buttons: 1, pressure: 0.5 }),
  );
  let focusMoves = pressed;
  if (pressed && !wdioDisabled(el)) {
    focusMoves = wdioMouseDown(el, { ...init, buttons: 1 });
  }
  if (focusMoves) {
    wdioFocusForClick(el);
  }
  window.__wdio_press = { init, pressed };
}

// Element Click's release. The press's blur can enable or disable the control, so each step checks.
function wdioRelease(el) {
  const { init, pressed } = window.__wdio_press;
  window.__wdio_press = undefined;
  el.dispatchEvent(new PointerEvent('pointerup', wdioPointer(init)));
  if (pressed && !wdioDisabled(el)) {
    el.dispatchEvent(new MouseEvent('mouseup', init));
  }
  if (wdioDisabled(el)) {
    return;
  }
  // A component's own click() can pass the click to a control in its shadow root.
  if (wdioOwnMethod(el, 'click')) {
    el.click();
  } else {
    el.dispatchEvent(new PointerEvent('click', { ...wdioPointer(init), detail: 1 }));
  }
}

function wdioPointer(init) {
  return { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
}

function wdioDisabled(el) {
  return el.closest(':disabled:not(fieldset)');
}

// Returns whether the page left the mousedown uncancelled. The driver cancels it after the page's
// listeners, as WebKit, unlike Chromium, acts on a synthetic mousedown (a range thumb jumps to it).
function wdioMouseDown(el, init) {
  let pageCanceled;
  const cancel = (event) => {
    pageCanceled = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('mousedown', cancel);
  const uncanceled = el.dispatchEvent(new MouseEvent('mousedown', init));
  window.removeEventListener('mousedown', cancel);
  return pageCanceled === undefined ? uncanceled : !pageCanceled;
}

// Moves focus as a mousedown on `el` does: to `el` or its nearest ancestor a click can focus, or off
// the focused element when there is none.
function wdioFocusForClick(el) {
  wdioFlushPendingChange();
  const previous = wdioDeepActiveElement();
  let moved = false;
  const onFocus = () => {
    moved = true;
  };
  document.addEventListener('focus', onFocus, true);
  // `activeElement` reports a shadow host when focus is anywhere in its tree; that only counts as the
  // host holding focus when it delegates focus.
  const holdsFocus = (node) =>
    node.getRootNode().activeElement === node && (!node.shadowRoot?.activeElement || node.shadowRoot.delegatesFocus);
  let node = el;
  // The walk follows the tree as rendered, through the slot that shows a slotted element.
  for (; node && node !== document.body; node = node.assignedSlot || node.parentNode || node.host) {
    if (typeof node.focus !== 'function') {
      continue;
    }
    // An element that already has focus keeps it, even one a click couldn't have focused.
    if (holdsFocus(node)) {
      break;
    }
    if (!wdioClickFocusable(node)) {
      continue;
    }
    wdioCaretToEnd(node);
    node.focus({ preventScroll: true });
    // Stop once focus has moved, even back to where it was, or a component's own focus() kept it inside
    // the component.
    if (
      moved ||
      wdioDeepActiveElement() !== previous ||
      (wdioOwnMethod(node, 'focus') && wdioContains(node, previous))
    ) {
      break;
    }
  }
  document.removeEventListener('focus', onFocus, true);
  if (!node || node === document.body) {
    const active = wdioDeepActiveElement();
    if (active !== document.body) {
      active.blur();
    }
  }
  wdioFlushPendingChange();
}

// A label's focus() focuses its field, and Chromium's focuses a scrolling box, which no mousedown does.
// Custom elements count, as one can delegate focus through a closed shadow root or its own focus()
// method.
function wdioClickFocusable(node) {
  return (
    node.matches(WDIO_CLICK_FOCUSABLE) ||
    (node.isContentEditable && !node.parentElement?.isContentEditable) ||
    node.localName.includes('-') ||
    node.shadowRoot?.delegatesFocus ||
    wdioOwnMethod(node, 'focus')
  );
}

// A caret set before focus stops WebKit selecting a fresh field's text, or putting a textarea's caret
// first, while a select-on-focus handler still picks its own selection.
function wdioCaretToEnd(el) {
  try {
    el.setSelectionRange?.(el.value.length, el.value.length);
  } catch {
    // Inputs such as checkboxes have no selection.
  }
}

// Whether `node` overrides a built-in method, as components do to pass focus or a click inward.
function wdioOwnMethod(node, name) {
  return node instanceof HTMLElement && node[name] !== HTMLElement.prototype[name];
}

// Whether `el` is `node` or inside it, looking through shadow roots.
function wdioContains(node, el) {
  for (let current = el; current; current = current.parentNode || current.host) {
    if (current === node) {
      return true;
    }
  }
  return false;
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
  wdioFocus(el);
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
  if (el.readOnly || el.matches(':disabled')) {
    return 'immutable';
  }
  wdioFocus(el);
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
