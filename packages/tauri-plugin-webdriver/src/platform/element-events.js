// biome-ignore-all lint/correctness/noUnusedVariables: the Rust drivers paste this file into page scripts that call its functions
// Page-side helpers for the embedded drivers' element commands: the focus moves and form events
// a user's input causes in a browser. A published crate can only include its own files, so
// tauri-plugin-wdio-webdriver and wdio-dioxus-embedded-driver each keep an identical copy.
// test/scripts/element-events.spec.ts tests it and checks the copies match.

// Tauri's key_input.rs reads this declaration.
const WDIO_TEXT_FIELD_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'number'];

const WDIO_CLEARABLE_INPUT_TYPES = [
  ...WDIO_TEXT_FIELD_TYPES,
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

// The buttons Enter and Space click in a browser.
const WDIO_KEY_ACTIVATED_INPUT_TYPES = ['button', 'image', 'reset', 'submit'];

// The drivers click only the buttons, as clicking a colour or file input opens a picker.
const WDIO_CLICKED_ON_ENTER_TYPES = [...WDIO_KEY_ACTIVATED_INPUT_TYPES, 'color', 'file'];

const WDIO_CLICK_FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, iframe, summary, audio[controls], video[controls], [tabindex]';

// The focused element, looking through open shadow roots, or null in an empty document.
function wdioDeepActiveElement() {
  let el = document.activeElement || document.body;
  while (el?.shadowRoot?.activeElement) {
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

// Implicit submission, as Chromium runs it. From a text field, a disabled default button blocks
// it, even with an enabled button after it.
function wdioSubmitOnEnter(el) {
  const form = el.tagName === 'INPUT' ? el.form : undefined;
  if (!form || WDIO_CLICKED_ON_ENTER_TYPES.includes(el.type)) {
    return;
  }
  // Called through the prototypes, as a control named after a form method hides it.
  const controls = Array.from(Node.prototype.getRootNode.call(form).querySelectorAll('button, input')).filter(
    (control) => control.form === form,
  );
  const buttons = controls.filter((control) => control.type === 'submit' || control.type === 'image');
  if (!WDIO_TEXT_FIELD_TYPES.includes(el.type)) {
    buttons.find((button) => !wdioDisabled(button))?.click();
  } else if (buttons.length > 0) {
    if (!wdioDisabled(buttons[0])) {
      buttons[0].click();
    }
  } else if (controls.filter((control) => WDIO_TEXT_FIELD_TYPES.includes(control.type)).length === 1) {
    // Safari before 16 has no requestSubmit.
    HTMLFormElement.prototype.requestSubmit?.call(form);
  }
}

function wdioKeyActivated(el) {
  return el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && WDIO_KEY_ACTIVATED_INPUT_TYPES.includes(el.type));
}

function wdioClickOnEnter(el) {
  if (wdioKeyActivated(el)) {
    el.click();
  }
}

// Enter's default action. It goes to the element focused after the keydown, as a browser's keypress
// does, after any `change` owed by a field that a keydown handler moved focus from.
function wdioEnterKey() {
  wdioFlushPendingChange();
  const el = wdioDeepActiveElement();
  if (!el) {
    return;
  }
  wdioCommitOnEnter(el);
  wdioSubmitOnEnter(el);
  wdioClickOnEnter(el);
}

// Space clicks a button on the keyup rather than the keydown, and only if the keydown went to it.
// `blocked` is true when a handler cancelled the key event, or Control, Alt or Meta is held. A
// blocked repeat keydown leaves the press it repeats, as in Chrome.
function wdioSpaceDown(el, blocked) {
  if (!blocked) {
    window.__wdio_space_down = el;
  }
}

function wdioSpaceUp(el, blocked) {
  const pressed = window.__wdio_space_down;
  window.__wdio_space_down = undefined;
  if (!blocked && pressed === el && wdioKeyActivated(el)) {
    el.click();
  }
}

// Tab's default action, which Control, Alt or Meta blocks. Chrome selects the text field Tab moves to,
// and past either end of the order hands focus to the browser's own controls.
function wdioTabKey(event) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  const next = wdioNextTabStop(event.shiftKey);
  if (!next) {
    wdioFlushPendingChange();
    wdioDeepActiveElement()?.blur();
    wdioFlushPendingChange();
    return;
  }
  wdioFocus(next);
  if (wdioDeepActiveElement() === next && next.tagName === 'INPUT' && WDIO_TEXT_FIELD_TYPES.includes(next.type)) {
    next.select();
  }
}

// From an element Tab skips, Tab goes to the nearest stop after it in tree order, or before it with
// Shift, and Chrome wraps round to the other end of the order when there's none.
function wdioNextTabStop(backward) {
  const current = wdioDeepActiveElement();
  const { stops, treeOrder } = wdioTabStops(current);
  const at = stops.indexOf(current);
  if (at !== -1) {
    return stops[backward ? at - 1 : at + 1];
  }
  const position = current === document.body ? undefined : treeOrder.get(current);
  const nearer =
    position === undefined
      ? []
      : stops
          .filter((stop) => (backward ? treeOrder.get(stop) < position : treeOrder.get(stop) > position))
          .sort((a, b) => treeOrder.get(a) - treeOrder.get(b));
  const candidates = nearer.length > 0 ? nearer : stops;
  return backward ? candidates[candidates.length - 1] : candidates[0];
}

// The elements Tab stops on, in order, and each visited element's position in the rendered tree. The
// document, each shadow tree and each slot order their own stops, positive tabindex first; a host's
// or slot's stops take its place, and a negative tabindex on it skips them.
function wdioTabStops(current) {
  const treeOrder = new Map();
  let modal;
  const scopeStops = (elements) => {
    const entries = [];
    const visit = (el) => {
      treeOrder.set(el, treeOrder.size);
      if (el.hasAttribute('inert') || getComputedStyle(el).display === 'none') {
        return;
      }
      if (wdioModal(el)) {
        modal = el;
      }
      const tabIndex = wdioTabIndex(el);
      const isStop = tabIndex >= 0 && wdioVisible(el);
      const scope = el.shadowRoot ? el.shadowRoot.children : el.localName === 'slot' ? wdioSlotted(el) : undefined;
      if (!scope) {
        if (isStop) {
          entries.push({ index: tabIndex, stops: [el] });
        }
        for (const child of wdioRenderedChildren(el)) {
          visit(child);
        }
        return;
      }
      // A host or slot without a valid tabindex takes its place in tree order.
      const parsed = Number.parseInt(el.getAttribute('tabindex'), 10);
      const index = Number.isNaN(parsed) ? 0 : parsed;
      if (index >= 0) {
        const host = isStop && el.shadowRoot && !el.shadowRoot.delegatesFocus ? [el] : [];
        entries.push({ index, stops: [...host, ...scopeStops(scope)] });
      }
    };
    for (const el of elements) {
      visit(el);
    }
    const positive = entries.filter((entry) => entry.index > 0).sort((a, b) => a.index - b.index);
    return [...positive, ...entries.filter((entry) => entry.index === 0)].flatMap((entry) => entry.stops);
  };
  const root = document.documentElement;
  let stops = root ? scopeStops([root]) : [];
  // A modal dialog makes the rest of the page inert.
  if (modal) {
    stops = stops.filter((stop) => wdioContains(modal, stop));
  }
  return { stops: stops.filter((stop) => wdioRadioStop(stop, current, stops)), treeOrder };
}

// The element's tabindex value, or -1 if it can't take focus.
function wdioTabIndex(el) {
  if (el.matches(':disabled')) {
    return -1;
  }
  if (el.hasAttribute('tabindex')) {
    return el.tabIndex ?? -1;
  }
  switch (el.localName) {
    case 'a':
      return el.hasAttribute('href') ? 0 : -1;
    case 'input':
      return el.type === 'hidden' ? -1 : 0;
    case 'button':
    case 'select':
    case 'textarea':
    case 'iframe':
      return 0;
    case 'audio':
    case 'video':
      return el.hasAttribute('controls') ? 0 : -1;
    case 'summary':
      return el.parentElement?.localName === 'details' && wdioSummary(el.parentElement) === el ? 0 : -1;
    default:
      return el.isContentEditable && !el.parentElement?.isContentEditable ? 0 : -1;
  }
}

function wdioVisible(el) {
  return getComputedStyle(el).visibility === 'visible';
}

// `:modal` is a syntax error in engines that don't support it.
function wdioModal(el) {
  try {
    return el.localName === 'dialog' && el.matches(':modal');
  } catch {
    return false;
  }
}

// A closed <details> shows only its summary.
function wdioRenderedChildren(el) {
  if (el.localName === 'details' && !el.hasAttribute('open')) {
    const summary = wdioSummary(el);
    return summary ? [summary] : [];
  }
  return el.children;
}

function wdioSummary(details) {
  return Array.from(details.children).find((child) => child.localName === 'summary');
}

// A slot shows the nodes assigned to it, or its own children when none are.
function wdioSlotted(slot) {
  const assigned = slot.assignedNodes();
  return assigned.length > 0 ? assigned.filter((node) => node.nodeType === Node.ELEMENT_NODE) : slot.children;
}

// A radio group is one stop: its checked radio, or if Tab can't stop on that, whichever radio Tab
// reaches first. Tab doesn't stop on another radio of the group that has focus.
function wdioRadioStop(el, current, stops) {
  if (el === current || !wdioNamedRadio(el)) {
    return true;
  }
  const root = el.getRootNode();
  const inGroup = (other) =>
    wdioNamedRadio(other) && other.name === el.name && other.form === el.form && other.getRootNode() === root;
  if (current && inGroup(current)) {
    return false;
  }
  return el.checked || !stops.some((stop) => stop.checked && inGroup(stop));
}

function wdioNamedRadio(el) {
  return el.localName === 'input' && el.type === 'radio' && el.name !== '';
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
