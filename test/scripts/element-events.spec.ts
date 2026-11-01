// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no delegatesFocus, so the E2E specs cover shadow hosts that keep focus.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/element-events.js';
const DIOXUS_COPY = 'packages/dioxus-embedded-driver/src/server/handlers/element-events.js';

type ElementEvents = {
  wdioRecordPendingChange(el: HTMLElement, value: string): void;
  wdioTakePendingChange(el?: HTMLElement): { el: HTMLElement; value: string } | undefined;
  wdioCommitOnEnter(el: HTMLElement): void;
  wdioSubmitOnEnter(el: HTMLElement): void;
  wdioKeyClick(el: HTMLElement): void;
  wdioEnterKey(): void;
  wdioSpaceDown(el: HTMLElement, blocked: boolean): void;
  wdioSpaceUp(el: HTMLElement, blocked: boolean): void;
  wdioTabKey(event: KeyboardEvent): void;
  wdioTabStops(current: Element): { stops: Element[] };
  wdioPress(el: HTMLElement): void;
  wdioRelease(el: HTMLElement): void;
  wdioFocusForClick(el: HTMLElement): void;
  wdioClearElement(el: HTMLElement): 'not editable' | 'empty' | 'cleared';
  wdioSetValueControl(el: HTMLElement, typed: string): 'immutable' | 'invalid' | 'set' | undefined;
};

const source = readFileSync(join(REPO_ROOT, TAURI_COPY), 'utf8');
const events = new Function(
  `${source}
  return { wdioRecordPendingChange, wdioTakePendingChange, wdioCommitOnEnter, wdioSubmitOnEnter, wdioKeyClick, wdioEnterKey, wdioSpaceDown, wdioSpaceUp, wdioTabKey, wdioTabStops, wdioPress, wdioRelease, wdioFocusForClick, wdioClearElement, wdioSetValueControl };`,
)() as ElementEvents;

let log: string[];

function $(selector: string) {
  return document.querySelector(selector) as HTMLInputElement;
}

// Logs each element's input, change, focus and blur events with its id and value.
function render(html: string) {
  document.body.innerHTML = html;
  log = [];
  for (const el of document.querySelectorAll<HTMLInputElement>('[id]:not(form)')) {
    for (const type of ['input', 'change', 'focus', 'blur']) {
      el.addEventListener(type, () => log.push(`${type} ${el.id}${el.value === undefined ? '' : `=${el.value}`}`));
    }
  }
}

// What Send Keys does to a text field: focus it, record the change it owes, and type.
function type(el: HTMLInputElement, text: string) {
  el.focus();
  events.wdioRecordPendingChange(el, el.value);
  el.value += text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  log = [];
}

// Stops `blur` reaching the page, as Chromium does on scripted focus moves while the window isn't
// focused.
function withoutBlur(run: () => void) {
  const stop = (event: Event) => event.stopImmediatePropagation();
  window.addEventListener('blur', stop, true);
  try {
    run();
  } finally {
    window.removeEventListener('blur', stop, true);
  }
}

// Element Click: the driver runs the press and the release as separate scripts.
function click(el: HTMLElement) {
  events.wdioPress(el);
  events.wdioRelease(el);
}

describe('element-events.js', () => {
  it('should be the same in both embedded driver crates', () => {
    expect(readFileSync(join(REPO_ROOT, DIOXUS_COPY), 'utf8'), `copy ${TAURI_COPY} over ${DIOXUS_COPY}`).toBe(source);
  });
});

beforeEach(() => {
  events.wdioTakePendingChange();
  Reflect.deleteProperty(window, '__wdio_space_down');
  (document.activeElement as HTMLElement | null)?.blur();
});

describe('pending change', () => {
  beforeEach(() => render('<input id="a"><input id="b">'));

  it('should fire change before blur however focus leaves the field', () => {
    type($('#a'), 'x');
    $('#b').focus();
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus b=']);
  });

  it('should fire no change when the value is back to what it was', () => {
    type($('#a'), 'x');
    $('#a').value = '';
    $('#a').blur();
    expect(log).toEqual(['blur a=']);
  });

  it('should keep the value from before the first edit', () => {
    type($('#a'), 'x');
    type($('#a'), 'y');
    $('#a').blur();
    expect(log).toEqual(['change a=xy', 'blur a=xy']);
  });

  it('should fire it only once', () => {
    type($('#a'), 'x');
    $('#a').blur();
    $('#a').focus();
    $('#a').blur();
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus a=x', 'blur a=x']);
  });

  it('should fire it when the driver next moves focus, if focus left the field without a blur', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['change a=x', 'focus b=']);
  });

  it('should fire it before the driver focuses the field again, if focus left it without a blur', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioClearElement($('#a'));
    expect(log).toEqual(['change a=x', 'focus a=x', 'input a=', 'change a=', 'blur a=']);
  });

  it.each([
    ['a click', () => events.wdioFocusForClick($('#b'))],
    ['a clear', () => events.wdioClearElement($('#b'))],
  ])('should fire it when %s moves focus without a blur', (_, run) => {
    $('#b').value = 'y';
    type($('#a'), 'x');
    withoutBlur(run);
    expect(log.filter((entry) => entry.startsWith('change a'))).toEqual(['change a=x']);
  });

  it('should fire nothing on a field the page has removed', () => {
    type($('#a'), 'x');
    $('#a').remove();
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['focus b=']);
  });

  it('should fire it rather than drop it when another field records a change', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioRecordPendingChange($('#b'), '');
    expect(log).toEqual(['change a=x']);
  });

  it('should fire change before blur when focus moves inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="s"><button id="t">t</button>';
    const field = root.querySelector('#s') as HTMLInputElement;
    const shadowLog: string[] = [];
    field.addEventListener('change', () => shadowLog.push('change'));
    field.addEventListener('blur', () => shadowLog.push('blur'));
    field.focus();
    field.value = 'x';
    events.wdioRecordPendingChange(field, '');
    (root.querySelector('#t') as HTMLElement).focus();
    expect(shadowLog).toEqual(['change', 'blur']);
  });
});

describe('wdioCommitOnEnter', () => {
  beforeEach(() => render('<input id="a"><textarea id="t"></textarea>'));

  it('should fire the change an input owes, and none again when focus leaves', () => {
    type($('#a'), 'x');
    events.wdioCommitOnEnter($('#a'));
    $('#a').blur();
    expect(log).toEqual(['change a=x', 'blur a=x']);
  });

  it('should owe a change for edits after the Enter', () => {
    type($('#a'), 'x');
    events.wdioCommitOnEnter($('#a'));
    type($('#a'), 'y');
    $('#a').blur();
    expect(log).toEqual(['change a=xy', 'blur a=xy']);
  });

  it('should leave a textarea, or an unchanged input, owing nothing', () => {
    type($('#t'), 'x');
    events.wdioCommitOnEnter($('#t'));
    expect(log).toEqual([]);
    type($('#a'), '');
    events.wdioCommitOnEnter($('#a'));
    expect(log).toEqual([]);
  });
});

describe('wdioSubmitOnEnter', () => {
  const logClick = (event: Event) => log.push(`click ${(event.target as HTMLElement).id}`);
  // Cancels the submit, as jsdom can't navigate.
  const logSubmit = (event: Event) => {
    const { submitter } = event as SubmitEvent;
    log.push(`submit ${(event.target as HTMLElement).id}${submitter ? ` by ${submitter.id}` : ''}`);
    event.preventDefault();
  };
  beforeAll(() => {
    window.addEventListener('click', logClick, true);
    window.addEventListener('submit', logSubmit, true);
  });
  afterAll(() => {
    window.removeEventListener('click', logClick, true);
    window.removeEventListener('submit', logSubmit, true);
  });

  function enter(html: string) {
    render(html);
    $('#i').focus();
    log = [];
    events.wdioSubmitOnEnter($('#i'));
  }

  it("should click the form's default button after the change the input commits", () => {
    render('<form id="f"><input id="i"><button id="b">go</button></form>');
    type($('#i'), 'x');
    events.wdioCommitOnEnter($('#i'));
    events.wdioSubmitOnEnter($('#i'));
    expect(log).toEqual(['change i=x', 'click b', 'submit f by b']);
  });

  it.each([
    ['a button or reset button', '<button type="button" id="x">x</button><button type="reset" id="r">r</button>'],
    ['another text field', '<input id="j">'],
  ])('should click the first submit button, after %s', (_, before) => {
    enter(`<form id="f"><input id="i">${before}<input type="submit" id="b"><button id="b2">go</button></form>`);
    expect(log).toEqual(['click b', 'submit f by b']);
  });

  it.each([
    [
      'a button outside the form, associated with it and before it',
      '<button form="f" id="b">go</button><form id="f"><input id="i"><button id="b2">go</button></form>',
    ],
    ['an image input', '<form id="f"><input id="i"><input type="image" id="b" alt="go"></form>'],
  ])('should click the default button when it is %s', (_, html) => {
    enter(html);
    expect(log).toEqual(['click b', 'submit f by b']);
  });

  it.each([
    ['disabled', '<button id="b" disabled>go</button>'],
    ['in a disabled fieldset', '<fieldset disabled><button id="b">go</button></fieldset>'],
  ])('should submit nothing when the default button is %s, though a later one is enabled', (_, button) => {
    enter(`<form id="f"><input id="i">${button}<button id="b2">go</button></form>`);
    expect(log).toEqual([]);
  });

  it('should submit nothing when a click handler cancels the click', () => {
    render('<form id="f"><input id="i"><button id="b">go</button></form>');
    $('#b').addEventListener('click', (event) => event.preventDefault());
    $('#i').focus();
    log = [];
    events.wdioSubmitOnEnter($('#i'));
    expect(log).toEqual(['click b']);
  });

  it('should submit a form without a submit button whose other fields are not text fields', () => {
    enter(
      `<form id="f"><input id="i"><input type="checkbox" id="c"><input type="date" id="d"><input type="range" id="r">
        <input type="hidden" id="h"><textarea id="t"></textarea><select id="s"></select></form>`,
    );
    expect(log).toEqual(['submit f']);
  });

  it('should submit a form whose controls are named after its methods', () => {
    render('<form id="f"><input id="i" name="requestSubmit"><input type="checkbox" id="c" name="getRootNode"></form>');
    // Browsers make named controls properties of the form, hiding its methods. jsdom doesn't.
    const form = document.querySelector('form') as HTMLFormElement;
    for (const name of ['requestSubmit', 'getRootNode']) {
      Object.defineProperty(form, name, { value: form.elements.namedItem(name) });
    }
    $('#i').focus();
    log = [];
    events.wdioSubmitOnEnter($('#i'));
    expect(log).toEqual(['submit f']);
  });

  it('should submit nothing, rather than throw, where forms have no requestSubmit', () => {
    const proto = HTMLFormElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'requestSubmit') as PropertyDescriptor;
    Reflect.deleteProperty(proto, 'requestSubmit');
    try {
      enter('<form id="f"><input id="i"></form>');
      expect(log).toEqual([]);
    } finally {
      Object.defineProperty(proto, 'requestSubmit', descriptor);
    }
  });

  it.each([
    ['text field', '<input id="j">'],
    ['number input', '<input type="number" id="j">'],
    ['read-only text field', '<input id="j" readonly>'],
    ['disabled text field', '<input id="j" disabled>'],
  ])('should submit nothing from a form without a submit button and with another %s', (_, other) => {
    enter(`<form id="f"><input type="search" id="i">${other}</form>`);
    expect(log).toEqual([]);
  });

  it('should click the first enabled submit button on Enter in any other input', () => {
    enter(
      '<form id="f"><input type="checkbox" id="i"><button id="b" disabled>go</button><button id="b2">go</button></form>',
    );
    expect(log).toEqual(['click b2', 'submit f by b2']);
    enter('<form id="f"><input type="date" id="i"></form>');
    expect(log).toEqual([]);
  });

  it.each(['submit', 'image', 'reset', 'button', 'color', 'file'])(
    'should leave the form of a %s input alone',
    (inputType) => {
      enter(`<form id="f"><input type="${inputType}" id="i" alt="i"><button id="b">go</button></form>`);
      expect(log).toEqual([]);
    },
  );

  it('should submit nothing from an input outside a form, or a textarea', () => {
    enter('<input id="i"><form id="f"><button id="b">go</button></form>');
    expect(log).toEqual([]);
    enter('<form id="f"><textarea id="i"></textarea><button id="b">go</button></form>');
    expect(log).toEqual([]);
  });

  it('should find the default button of a form in a shadow root', () => {
    render('<div id="host"></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<form id="f"><input id="i"></form><button form="f" id="b">go</button>';
    const form = root.querySelector('form') as HTMLFormElement;
    form.addEventListener('submit', logSubmit);
    events.wdioSubmitOnEnter(root.querySelector('#i') as HTMLInputElement);
    expect(log).toEqual(['click host', 'submit f by b']);
  });
});

describe('Enter and Space on a button', () => {
  // Cancels the submit, as jsdom can't navigate.
  const logEvent = (event: Event) => {
    const { submitter } = event as SubmitEvent;
    log.push(`${event.type} ${(event.target as HTMLElement).id}${submitter ? ` by ${submitter.id}` : ''}`);
    if (event.type === 'submit') {
      event.preventDefault();
    }
  };
  beforeAll(() => {
    for (const type of ['click', 'submit', 'reset']) {
      window.addEventListener(type, logEvent, true);
    }
  });
  afterAll(() => {
    for (const type of ['click', 'submit', 'reset']) {
      window.removeEventListener(type, logEvent, true);
    }
  });

  function space(el: HTMLElement, { downCanceled = false, upCanceled = false } = {}) {
    events.wdioSpaceDown(el, downCanceled);
    events.wdioSpaceUp(el, upCanceled);
  }

  it.each([
    ['a button', '<button id="b">go</button>', ['click b', 'submit f by b']],
    ['a submit input', '<input type="submit" id="b">', ['click b', 'submit f by b']],
    ['an image input', '<input type="image" id="b" alt="go">', ['click b', 'submit f by b']],
    ['a plain button', '<button type="button" id="b">go</button>', ['click b']],
  ])('should click %s on Enter, and after Space', (_, button, expected) => {
    render(`<form id="f">${button}</form>`);
    events.wdioKeyClick($('#b'));
    expect(log).toEqual(expected);
    log = [];
    space($('#b'));
    expect(log).toEqual(expected);
  });

  it('should reset the form from a reset button', () => {
    render('<form id="f"><input id="i" value="v"><input type="reset" id="b"></form>');
    $('#i').value = 'changed';
    space($('#b'));
    expect(log).toEqual(['click b', 'reset f']);
    expect($('#i').value).toBe('v');
  });

  it('should click a button outside a form', () => {
    render('<button id="b">go</button>');
    events.wdioKeyClick($('#b'));
    space($('#b'));
    expect(log).toEqual(['click b', 'click b']);
  });

  it.each(['text', 'checkbox', 'color', 'file'])('should not click a %s input', (inputType) => {
    render(`<form id="f"><input type="${inputType}" id="b"></form>`);
    events.wdioKeyClick($('#b'));
    space($('#b'));
    expect(log).toEqual([]);
  });

  it('should not click on Space when a handler cancels the keydown or the keyup', () => {
    render('<button id="b">go</button>');
    space($('#b'), { downCanceled: true });
    space($('#b'), { upCanceled: true });
    expect(log).toEqual([]);
  });

  it('should not click on Space when the keyup goes to another element, nor on a later keyup', () => {
    render('<button id="b">go</button><button id="c">go</button>');
    events.wdioSpaceDown($('#b'), false);
    events.wdioSpaceUp($('#c'), false);
    events.wdioSpaceUp($('#b'), false);
    expect(log).toEqual([]);
  });

  it('should commit and submit from the focused field on Enter', () => {
    render('<form id="f"><input id="i"><button id="b">go</button></form>');
    type($('#i'), 'x');
    events.wdioEnterKey();
    expect(log).toEqual(['change i=x', 'click b', 'submit f by b']);
  });

  it.each([
    ['submit input', '<input type="submit" id="b">', ['click b', 'submit f by b']],
    ['submit button', '<button id="b">go</button>', ['click b', 'submit f by b']],
  ])('should click a focused %s once on Enter, without implicit submission', (_, button, expected) => {
    render(`<form id="f">${button}<button id="s">go</button></form>`);
    $('#b').focus();
    log = [];
    events.wdioEnterKey();
    expect(log).toEqual(expected);
  });

  it.each([
    ['', ['change i=x', 'blur i=x', 'focus b=', 'click b']],
    // WebView2 skips the blur while its window isn't focused.
    [' without a blur', ['focus b=', 'change i=x', 'click b']],
  ])("should click the button a keydown handler moved focus to%s, after the field's change", (noBlur, expected) => {
    render('<form id="f"><input id="i"><button type="button" id="b">go</button><button id="s">go</button></form>');
    type($('#i'), 'x');
    const keydownHandler = () => $('#b').focus();
    if (noBlur) {
      withoutBlur(keydownHandler);
    } else {
      keydownHandler();
    }
    events.wdioEnterKey();
    expect(log).toEqual(expected);
  });
});

describe('Tab', () => {
  afterEach(() => {
    document.body.removeAttribute('tabindex');
    Reflect.deleteProperty(document.body, 'matches');
    vi.restoreAllMocks();
  });

  function focused() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  // Tab as the drivers press it: the keydown goes to the focused element, then its default action runs.
  function tab(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...init });
    focused()?.dispatchEvent(event);
    events.wdioTabKey(event);
    const el = focused();
    return el?.id || el?.localName;
  }

  function tabs(count: number, init: KeyboardEventInit = {}) {
    return Array.from({ length: count }, () => tab(init));
  }

  it('should visit positive tabindex ascending, then tabindex 0 and natural stops in tree order, then leave the page', () => {
    render(`<input id="a"><button id="b">b</button><a id="l" href="#">l</a><a id="nohref">x</a>
      <span id="s" tabindex="0">s</span><div id="n" tabindex="-1">n</div><input id="p2" tabindex="2">
      <input id="p1" tabindex="1"><input type="hidden" id="h"><input id="p1b" tabindex="1"><select id="sel"></select>
      <textarea id="t"></textarea><iframe id="f"></iframe><audio id="silent"></audio>
      <details><summary id="sum">sum</summary></details>`);
    expect(tabs(13)).toEqual(['p1', 'p1b', 'p2', 'a', 'b', 'l', 's', 'sel', 't', 'f', 'sum', 'body', 'p1']);
  });

  it('should go back through the same stops with Shift', () => {
    render('<input id="a"><input id="p1" tabindex="1"><button id="b">b</button>');
    expect(tabs(5, { shiftKey: true })).toEqual(['b', 'a', 'p1', 'body', 'b']);
  });

  it('should skip disabled, inert and unrendered elements', () => {
    render(`<input id="a"><input id="d" disabled><fieldset disabled><input id="fd"></fieldset>
      <div inert><input id="i"></div><input id="hidden" hidden><div style="display: none"><input id="none"></div>
      <div style="visibility: hidden"><input id="vh"><input id="vv" style="visibility: visible"></div>
      <details><summary id="sum">sum</summary><input id="closed"></details>
      <details open><summary id="sum2">sum</summary><input id="open"></details><input id="z">`);
    $('#a').focus();
    expect(tabs(5)).toEqual(['vv', 'sum', 'sum2', 'open', 'z']);
  });

  it('should stop on an editing host, media with controls and slot fallback content, but not in a slot with tabindex -1', () => {
    render(`<div id="ed" contenteditable="true"><p id="ed-p">x</p></div><audio id="au" controls></audio>
      <video id="vid"></video><object id="ob"></object><embed id="em"><div id="h1"></div>
      <div id="h2"><input id="h2-slotted"></div>`);
    // jsdom has no isContentEditable.
    for (const id of ['ed', 'ed-p']) {
      Object.defineProperty($(`#${id}`), 'isContentEditable', { value: true });
    }
    $('#h1').attachShadow({ mode: 'open' }).innerHTML = '<slot><input id="fallback"></slot>';
    $('#h2').attachShadow({ mode: 'open' }).innerHTML = '<input id="h2-a"><slot tabindex="-1"></slot>';
    expect(events.wdioTabStops(document.body).stops.map((stop) => stop.id)).toEqual([
      'ed',
      'au',
      'ob',
      'em',
      'fallback',
      'h2-a',
    ]);
  });

  it('should go through a form whose controls hide its own properties', () => {
    render('<input id="a"><form id="f"><input id="kids" name="children"><input id="e"></form><input id="z">');
    // Browsers make named controls properties of the form, hiding its own. jsdom doesn't.
    for (const name of ['children', 'matches', 'hasAttribute']) {
      Object.defineProperty($('#f'), name, { value: $('#kids') });
    }
    $('#a').focus();
    expect(tabs(3)).toEqual(['kids', 'e', 'z']);
  });

  it('should go through open shadow roots and slots, with focus-delegating hosts no stop themselves', () => {
    render(`<input id="a"><div id="h1"><input id="h1-slotted"></div><div id="h2" tabindex="0"></div>
      <div id="h3" tabindex="-1"></div><div id="h4" tabindex="0"></div><input id="z">`);
    const shadow = (host: string, html: string) => {
      const root = $(host).attachShadow({ mode: 'open' });
      root.innerHTML = html;
      return root;
    };
    shadow('#h1', '<input id="h1-a"><slot></slot><input id="h1-b" tabindex="1">');
    shadow('#h2', '<input id="h2-a">');
    shadow('#h3', '<input id="h3-a">');
    // jsdom has no delegatesFocus.
    Object.defineProperty(shadow('#h4', '<input id="h4-a">'), 'delegatesFocus', { value: true });
    $('#a').focus();
    expect(tabs(7)).toEqual(['h1-b', 'h1-a', 'h1-slotted', 'h2', 'h2-a', 'h4-a', 'z']);
    expect(tabs(7, { shiftKey: true })).toEqual(['h4-a', 'h2-a', 'h2', 'h1-slotted', 'h1-a', 'h1-b', 'a']);
  });

  it.each([
    ['none checked', '', ['r1', 'z'], ['r3', 'a']],
    ['one checked', 'r2', ['r2', 'z'], ['r2', 'a']],
    ['a disabled one checked', 'r1', ['r2', 'z'], ['r3', 'a']],
  ])('should stop once on a radio group with %s', (_, checked, forward, backward) => {
    render(`<input id="a"><input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2">
      <input type="radio" name="r" id="r3"><input id="z">`);
    if (checked) {
      $(`#${checked}`).checked = true;
    }
    $('#r1').disabled = checked === 'r1';
    $('#a').focus();
    expect(tabs(2)).toEqual(forward);
    $('#z').focus();
    expect(tabs(2, { shiftKey: true })).toEqual(backward);
  });

  it('should stop on each unnamed radio, and on radios with the same name in other forms', () => {
    render(`<input id="a"><input type="radio" id="u1"><input type="radio" id="u2">
      <form><input type="radio" name="r" id="f1"></form><form><input type="radio" name="r" id="f2"></form>`);
    $('#a').focus();
    expect(tabs(4)).toEqual(['u1', 'u2', 'f1', 'f2']);
  });

  it('should leave focus alone when a handler cancels the keydown, or Control, Alt or Meta is held', () => {
    render('<input id="a"><input id="b">');
    $('#a').addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    $('#a').focus();
    const presses = [{}, { ctrlKey: true }, { altKey: true }, { metaKey: true }];
    expect(presses.map((init) => tab(init))).toEqual(['a', 'a', 'a', 'a']);
  });

  it("should fire the field's change before blur, and select the next text field's value", () => {
    render('<input id="a"><input id="b" value="old"><textarea id="t">text</textarea>');
    type($('#a'), 'x');
    tab();
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus b=old']);
    expect([$('#b').selectionStart, $('#b').selectionEnd]).toEqual([0, 3]);
    tab();
    expect([$('#t').selectionStart, $('#t').selectionEnd]).toEqual([0, 0]);
  });

  it('should focus a text field once, though select() focuses it in Chromium', () => {
    const select = HTMLInputElement.prototype.select;
    vi.spyOn(HTMLInputElement.prototype, 'select').mockImplementation(function (this: HTMLInputElement) {
      select.call(this);
      this.focus();
    });
    render('<input id="a"><input id="guard" value="g"><input id="z">');
    $('#guard').addEventListener('focus', () => $('#z').focus(), { once: true });
    $('#a').focus();
    expect(tab()).toBe('z');
    expect(log.filter((entry) => entry.startsWith('focus'))).toEqual(['focus a=', 'focus guard=g', 'focus z=']);
  });

  it('should select email and number inputs too, though they have no selection API', () => {
    render('<input id="a"><input id="e" type="email" value="a@b.c"><input id="n" type="number" value="42">');
    const selected: string[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'select').mockImplementation(function (this: HTMLInputElement) {
      selected.push(`${this.id} focused=${document.activeElement === this}`);
    });
    $('#a').focus();
    tabs(2);
    expect(selected).toEqual(['e focused=true', 'n focused=true']);
  });

  it("should select the next text field's value after the field focus leaves fires its change", () => {
    render('<input id="zip"><input id="city">');
    $('#zip').addEventListener('change', () => {
      $('#city').value = 'Shelbyville';
    });
    type($('#zip'), '1');
    tab();
    expect([$('#city').selectionStart, $('#city').selectionEnd]).toEqual([0, 11]);
  });

  it('should leave the caret where the focus handler of the text field Tab moves to puts it', () => {
    render('<input id="a"><input id="ph" value="+1 ">');
    $('#ph').addEventListener('focus', () => $('#ph').setSelectionRange(3, 3));
    $('#a').focus();
    tab();
    expect([$('#ph').selectionStart, $('#ph').selectionEnd]).toEqual([3, 3]);
  });

  it.each([
    ['moving focus', '<input id="a"><input id="b">'],
    ['leaving the page', '<input id="a">'],
  ])("should fire the field's change when %s skips the blur", (_, html) => {
    render(html);
    type($('#a'), 'x');
    withoutBlur(() => tab());
    expect(log.filter((entry) => entry.startsWith('change'))).toEqual(['change a=x']);
  });

  it("should fire the field's change when a handler cancels Tab and moves focus without a blur", () => {
    render('<input id="a"><input id="b"><input id="c">');
    type($('#a'), 'x');
    // A focus trap's handler.
    const trap = (event: Event) => {
      event.preventDefault();
      withoutBlur(() => $('#c').focus());
    };
    $('#a').addEventListener('keydown', trap, { once: true });
    expect(tab()).toBe('c');
    expect(log.filter((entry) => entry.startsWith('change'))).toEqual(['change a=x']);
  });

  it('should go from an element Tab skips to the nearest stop in tree order, or leave the page when there is none', () => {
    render(`<div id="t1" tabindex="-1">t</div><input id="a"><div id="t2" tabindex="-1">t</div><input id="b">
      <div id="t3" tabindex="-1">t</div>`);
    const from = (id: string, init: KeyboardEventInit = {}) => {
      $(`#${id}`).focus();
      return tab(init);
    };
    expect([from('t2'), from('t2', { shiftKey: true }), from('t3'), from('t1', { shiftKey: true })]).toEqual([
      'b',
      'a',
      'body',
      'body',
    ]);
  });

  it('should tab from a body the page focused as from an element Tab skips', () => {
    render('<input id="a"><input id="p" tabindex="1">');
    document.body.tabIndex = -1;
    document.body.focus();
    const forward = tab();
    document.body.focus();
    expect([forward, tab({ shiftKey: true })]).toEqual(['a', 'body']);
  });

  it('should start at the first stop with nothing focused, even when the body is a stop', () => {
    render('<input id="p" tabindex="1"><input id="a"><input id="b">');
    document.body.tabIndex = 0;
    // jsdom has a focusable body match :focus when nothing else has focus, unlike browsers.
    Object.defineProperty(document.body, 'matches', {
      configurable: true,
      value: (selector: string) => selector !== ':focus' && Element.prototype.matches.call(document.body, selector),
    });
    const forward = tab();
    $('#p').blur();
    expect([forward, tab({ shiftKey: true })]).toEqual(['p', 'b']);
  });

  it('should keep focus within a modal dialog', () => {
    render('<input id="a"><dialog id="d" open><input id="d1"><input id="d2"></dialog><input id="z">');
    // jsdom has no showModal.
    const dialog = $('#d');
    Object.defineProperty(dialog, 'matches', {
      value: (selector: string) => selector === ':modal' || Element.prototype.matches.call(dialog, selector),
    });
    $('#d1').focus();
    expect(tabs(4)).toEqual(['d2', 'body', 'd1', 'd2']);
  });

  it("should keep focus within a shadow root's modal dialog, including the fields slotted into it", () => {
    render('<input id="a"><div id="host"><input id="s1"><input id="s2"></div><input id="z">');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<dialog open><slot></slot></dialog>';
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    Object.defineProperty(dialog, 'matches', {
      value: (selector: string) => selector === ':modal' || Element.prototype.matches.call(dialog, selector),
    });
    $('#s1').focus();
    expect(tabs(4)).toEqual(['s2', 'body', 's1', 's2']);
  });

  it('should leave focus where a focus trap sends it back', () => {
    render(
      '<input id="o1"><button id="g1">g1</button><button id="only">only</button><button id="g2">g2</button><input id="o2">',
    );
    for (const id of ['g1', 'g2']) {
      $(`#${id}`).addEventListener('focus', () => $('#only').focus());
    }
    $('#only').focus();
    expect([tab(), tab({ shiftKey: true })]).toEqual(['only', 'only']);
  });

  it('should leave focus where a focus trap in a shadow root sends it back', () => {
    render('<input id="o1"><div id="host"></div><input id="o2">');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="g1">g1</button><button id="only">only</button><button id="g2">g2</button>';
    const only = root.querySelector('#only') as HTMLElement;
    for (const id of ['#g1', '#g2']) {
      root.querySelector(id)?.addEventListener('focus', () => only.focus());
    }
    only.focus();
    expect([tab(), tab({ shiftKey: true })]).toEqual(['only', 'only']);
  });

  it('should focus each stop itself, never through a focus() the page defines', () => {
    render('<input id="a"><div id="host" tabindex="0"></div><input id="z">');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="inner">';
    $('#host').focus = () => (root.querySelector('#inner') as HTMLElement).focus();
    $('#a').focus();
    expect(tabs(3)).toEqual(['host', 'inner', 'z']);
  });

  it('should leave the page through the built-in blur(), never one the page defines', () => {
    render('<input id="a"><input id="z">');
    $('#z').blur = () => {};
    $('#z').focus();
    expect(tab()).toBe('body');
  });

  it("should pass Tab on from a stop the page won't focus", () => {
    render('<input id="x"><a id="bad" tabindex="foo">bad</a><input id="y">');
    $('#x').focus();
    expect(tabs(2)).toEqual(['y', 'body']);
    $('#y').focus();
    expect(tab({ shiftKey: true })).toBe('x');
    $('#y').remove();
    $('#x').focus();
    expect(tab()).toBe('body');
  });
});

describe('wdioPress and wdioRelease', () => {
  const CLICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  beforeEach(() => {
    render('<input id="a"><button id="b">b</button>');
    for (const name of CLICK_EVENTS) {
      $('#b').addEventListener(name, () => log.push(`${name} b`));
    }
  });

  it("should send a real click's events, moving focus as mousedown's default action", () => {
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual([
      'pointerdown b',
      'mousedown b',
      'change a=x',
      'blur a=x',
      'focus b=',
      'pointerup b',
      'mouseup b',
      'click b',
    ]);
  });

  it.each(['#d', '#inside'])(
    'should send %s, in a disabled control, pointer events but no mouse events or click, and still move focus',
    (selector) => {
      render('<input id="a"><div id="wrap"><button id="d" disabled><span id="inside">d</span></button></div>');
      for (const name of CLICK_EVENTS) {
        $('#wrap').addEventListener(name, () => log.push(name), true);
      }
      type($('#a'), 'x');
      click($(selector));
      expect(log).toEqual(['pointerdown', 'change a=x', 'blur a=x', 'pointerup']);
    },
  );

  it('should send no click to a control that a mouseup handler disables', () => {
    $('#b').addEventListener('mouseup', () => {
      ($('#b') as unknown as HTMLButtonElement).disabled = true;
    });
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'mousedown b', 'focus b=', 'pointerup b', 'mouseup b']);
  });

  it("should click a button that the click's own change enables", () => {
    render('<input id="a"><button id="save" disabled>save</button>');
    $('#a').addEventListener('change', () => {
      $('#save').disabled = false;
    });
    $('#save').addEventListener('click', () => log.push('click save'));
    type($('#a'), 'x');
    click($('#save'));
    expect(log).toEqual(['change a=x', 'blur a=x', 'click save']);
  });

  it('should leave focus where it is when the page cancels the mousedown', () => {
    $('#b').addEventListener('mousedown', (event) => event.preventDefault());
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'mousedown b', 'pointerup b', 'mouseup b', 'click b']);
    expect(document.activeElement).toBe($('#a'));
  });

  it('should send no mousedown or mouseup, and leave focus, when the page cancels the pointerdown', () => {
    $('#b').addEventListener('pointerdown', (event) => event.preventDefault());
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'pointerup b', 'click b']);
    expect(document.activeElement).toBe($('#a'));
  });

  it('should leave focus where it is when the page cancels the mousedown and stops it there', () => {
    $('#b').addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    type($('#a'), 'x');
    click($('#b'));
    expect(document.activeElement).toBe($('#a'));
  });

  it("should shape the events as Chrome's are", () => {
    const shapes: string[] = [];
    for (const name of CLICK_EVENTS) {
      $('#b').addEventListener(name, (event) => {
        const { detail, pointerType } = event as PointerEvent;
        shapes.push(`${name} ${event.constructor.name} ${detail} ${pointerType}`);
      });
    }
    click($('#b'));
    expect(shapes).toEqual([
      'pointerdown PointerEvent 0 mouse',
      'mousedown MouseEvent 0 undefined',
      'pointerup PointerEvent 0 mouse',
      'mouseup MouseEvent 0 undefined',
      'click PointerEvent 1 mouse',
    ]);
  });

  it('should put the caret at the end of a text field before focusing it', () => {
    render('<input id="f" value="hello">');
    $('#f').setSelectionRange(0, 0);
    click($('#f'));
    expect([$('#f').selectionStart, document.activeElement]).toEqual([5, $('#f')]);
  });

  it("should leave a field's selection alone when the page cancels the mousedown", () => {
    render('<input id="f" value="hello">');
    $('#f').setSelectionRange(1, 3);
    $('#f').addEventListener('mousedown', (event) => event.preventDefault());
    click($('#f'));
    expect([$('#f').selectionStart, $('#f').selectionEnd]).toEqual([1, 3]);
  });

  it("should click through a component's own click()", () => {
    render('<div id="host"></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner">inner</button>';
    const inner = root.querySelector('#inner') as HTMLButtonElement;
    $('#host').click = () => inner.click();
    inner.addEventListener('click', () => log.push('click inner'));
    click($('#host'));
    expect(log).toEqual(['click inner']);
  });

  it('should click an SVG element, which has no click()', () => {
    render('<svg id="icon"></svg>');
    const icon = document.querySelector('#icon') as Element;
    icon.addEventListener('click', () => log.push('click icon'));
    click(icon as HTMLElement);
    expect(log).toEqual(['click icon']);
  });
});

describe('wdioFocusForClick', () => {
  beforeEach(() =>
    render(`<input id="a"><button id="b"><span id="inner">b</span></button><div id="plain">plain</div>
      <label id="label" for="a">A</label><div id="box" tabindex="-1"><span id="text">text</span></div>`),
  );

  it('should move focus to the target, firing the owed change before blur', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus b=']);
  });

  it('should focus the nearest focusable ancestor', () => {
    events.wdioFocusForClick($('#inner'));
    events.wdioFocusForClick($('#text'));
    expect(log).toEqual(['focus b=', 'blur b=', 'focus box']);
  });

  it('should take focus off the field when nothing there can take it', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#plain'));
    expect(log).toEqual(['change a=x', 'blur a=x']);
    expect(document.activeElement).toBe(document.body);
  });

  it("should take focus off the field when the click lands on the field's label", () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#label'));
    expect(log).toEqual(['change a=x', 'blur a=x']);
  });

  it("should take focus off a field in a shadow host that doesn't delegate focus", () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="s">';
    const field = root.querySelector('#s') as HTMLInputElement;
    const shadowLog: string[] = [];
    field.addEventListener('change', () => shadowLog.push('change'));
    field.addEventListener('blur', () => shadowLog.push('blur'));
    field.focus();
    field.value = 'x';
    events.wdioRecordPendingChange(field, '');
    events.wdioFocusForClick(host);
    expect(shadowLog).toEqual(['change', 'blur']);
  });

  it('should focus the shadow button a slotted label is shown in', () => {
    render('<div id="host"><span id="label">save</span></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner"><slot></slot></button>';
    events.wdioFocusForClick($('#label'));
    expect(root.activeElement).toBe(root.querySelector('#inner'));
  });

  it("should leave focus where a component's own focus() sends it", () => {
    render('<div id="host"><input id="inner"></div>');
    $('#host').focus = () => $('#inner').focus();
    events.wdioFocusForClick($('#host'));
    expect(document.activeElement).toBe($('#inner'));
  });

  it('should leave focus where a focus handler hands it back', () => {
    render('<div id="wrap" tabindex="-1"><input id="f"><span id="icon">icon</span></div>');
    $('#wrap').addEventListener('focus', () => $('#f').focus());
    type($('#f'), 'x');
    events.wdioFocusForClick($('#icon'));
    expect(document.activeElement).toBe($('#f'));
  });

  it("should leave focus in a component's field when its own focus() keeps it there", () => {
    render('<div id="wrap" tabindex="-1"><my-field id="host"></my-field></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="inner">';
    const inner = root.querySelector('#inner') as HTMLInputElement;
    $('#host').focus = () => inner.focus();
    type(inner, 'x');
    events.wdioFocusForClick($('#host'));
    expect(root.activeElement).toBe(inner);
  });

  it('should leave focus where a focus handler passes it', () => {
    render('<div id="bar" tabindex="0"><button id="item">item</button><span id="words">text</span></div>');
    $('#bar').addEventListener('focus', () => $('#item').focus());
    events.wdioFocusForClick($('#words'));
    expect(document.activeElement).toBe($('#item'));
  });

  it('should leave focus on a focused target', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#a'));
    expect(log).toEqual([]);
    expect(document.activeElement).toBe($('#a'));
  });
});

describe('wdioClearElement', () => {
  beforeEach(() =>
    render(`<input id="a" value="old"><input id="empty"><input id="ro" readonly value="r">
      <input id="dis" disabled value="d"><fieldset disabled><input id="fs" value="f"></fieldset>
      <input id="cb" type="checkbox"><select id="sel"><option>1</option></select><div id="div">text</div>`),
  );

  it.each(['#ro', '#dis', '#fs', '#cb', '#sel', '#div'])('should refuse %s as not editable', (selector) => {
    expect(events.wdioClearElement($(selector))).toBe('not editable');
    expect(log).toEqual([]);
  });

  it('should leave an empty field alone', () => {
    expect(events.wdioClearElement($('#empty'))).toBe('empty');
    expect(log).toEqual([]);
  });

  it('should focus, empty the field with input and change, then blur', () => {
    expect(events.wdioClearElement($('#a'))).toBe('cleared');
    expect(log).toEqual(['focus a=old', 'input a=', 'change a=', 'blur a=']);
  });

  it('should compare against the value from before Send Keys edited the field', () => {
    type($('#empty'), 'x');
    events.wdioClearElement($('#empty'));
    expect(log).toEqual(['input empty=', 'blur empty=']);
  });

  it('should fire the change another field owes before that field blurs', () => {
    type($('#empty'), 'x');
    events.wdioClearElement($('#a'));
    expect(log.slice(0, 3)).toEqual(['change empty=x', 'blur empty=x', 'focus a=old']);
  });
});

describe('wdioSetValueControl', () => {
  beforeEach(() =>
    render(`<input id="d" type="date" value="2026-01-01"><input id="ro" type="date" readonly>
      <fieldset disabled><input id="fs" type="date"></fieldset><input id="t">`),
  );

  it('should set the value with input and change at once', () => {
    expect(events.wdioSetValueControl($('#d'), '2026-10-21')).toBe('set');
    expect(log).toEqual(['focus d=2026-01-01', 'input d=2026-10-21', 'change d=2026-10-21']);
  });

  it('should restore the value and report an invalid one', () => {
    expect(events.wdioSetValueControl($('#d'), 'not a date')).toBe('invalid');
    expect($('#d').value).toBe('2026-01-01');
  });

  it.each(['#ro', '#fs'])('should refuse %s as immutable', (selector) => {
    expect(events.wdioSetValueControl($(selector), '2026-10-21')).toBe('immutable');
  });

  it('should leave other elements, and empty text, to typing', () => {
    expect(events.wdioSetValueControl($('#t'), 'x')).toBeUndefined();
    expect(events.wdioSetValueControl($('#d'), '')).toBeUndefined();
    expect(log).toEqual([]);
  });
});
