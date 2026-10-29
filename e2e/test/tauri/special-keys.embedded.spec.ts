import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import '@wdio/native-types';

/**
 * WebDriver special keys (U+E000–U+E05D) through the embedded provider's own key mapping (#735).
 * The other providers hand keys to their upstream drivers, so wdio.tauri.conf.ts excludes this suite.
 */

const CONTROL_RIGHT = '\uE051';

type KeyEvent = {
  key: string;
  code: string;
  keyCode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

const noModifiers = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

async function keyTargetEvents() {
  return (await browser.execute('return window.__keyTargetEvents || []')) as unknown as KeyEvent[];
}

async function editorText(selector = '#keys-editor') {
  const text = (await browser.execute(`return document.querySelector("${selector}").textContent`)) as string;
  return text.replace(/\u00a0/g, ' ');
}

const NEWLINE = String.fromCharCode(10);

type ValueEvent = { type: string; value: string };

async function keysInputEvents() {
  return (await browser.execute('return window.__keysInputEvents || []')) as unknown as ValueEvent[];
}

async function fieldEvents() {
  return (await browser.execute('return window.__fieldEvents || []')) as unknown as string[];
}

// A field that logs its events with its value, and a button to move focus to.
async function fillChangeScratch({ initialValue = '', inShadowHost = false } = {}) {
  await fillScratch(
    `scratch.innerHTML = '<div id="fresh-host"></div><button id="fresh-other">other</button>';
    var host = document.querySelector("#fresh-host");
    var parent = ${inShadowHost ? 'host.attachShadow({ mode: "open", delegatesFocus: true })' : 'host'};
    parent.innerHTML = '<input id="fresh-field" value="${initialValue}">';
    window.__fieldEvents = [];
    for (var type of ["input", "change", "blur"]) {
      parent.querySelector("#fresh-field").addEventListener(type, function (ev) {
        window.__fieldEvents.push(ev.type + " " + ev.target.value);
      });
    }`,
  );
}

// A form holding `fields` that logs its key, change, click and submit events, and cancels its
// submit so the page stays.
async function fillFormScratch(fields: string) {
  await fillScratch(
    `scratch.innerHTML = '<form id="fresh-form">${fields}</form>';
    var form = document.querySelector("#fresh-form");
    window.__fieldEvents = [];
    for (var type of ["keydown", "keyup", "change", "click", "submit"]) {
      form.addEventListener(type, function (ev) {
        var detail = ev.type === "change" ? ev.target.value
          : ev.type === "submit" ? (ev.submitter ? ev.submitter.id : "without submitter")
          : ev.key || ev.target.id;
        window.__fieldEvents.push(ev.type + " " + detail);
      });
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); });`,
  );
}

async function fillScratch(script: string) {
  await browser.execute(`var scratch = document.querySelector("#keys-scratch"); ${script}`);
}

async function errorOf(action: Promise<unknown>) {
  return action.then(
    () => undefined,
    (error: Error) => error,
  );
}

describe('special keys (embedded)', () => {
  beforeEach(async () => {
    // Blur to fire any pending change, then reset the event logs.
    await browser.execute(
      'if (document.activeElement) { document.activeElement.blur(); }' +
        'window.__keyTargetEvents = [];' +
        'document.querySelector("#keys-input").value = "";' +
        'document.querySelector("#keys-editor").textContent = "";' +
        'document.querySelector("#keys-blocking-input").value = "";' +
        'document.querySelector("#keys-blocking-editor").textContent = "";' +
        'document.querySelector("#keys-textarea").value = "";' +
        'document.querySelector("#keys-scratch").innerHTML = "";' +
        'window.__keysInputEvents = [];',
    );
  });

  it('should deliver PageDown, PageUp, Home and End to the focused element', async () => {
    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');

    for (const key of [Key.PageDown, Key.PageUp, Key.Home, Key.End]) {
      await browser.keys(key);
    }

    expect(await keyTargetEvents()).toEqual([
      { key: 'PageDown', code: 'PageDown', keyCode: 34, ...noModifiers },
      { key: 'PageUp', code: 'PageUp', keyCode: 33, ...noModifiers },
      { key: 'Home', code: 'Home', keyCode: 36, ...noModifiers },
      { key: 'End', code: 'End', keyCode: 35, ...noModifiers },
    ]);
  });

  it('should press special keys inside addValue instead of typing them', async () => {
    const input = browser.$('#keys-input');
    await input.addValue(`abc${Key.Backspace}d${Key.PageDown}`);
    expect(await input.getValue()).toBe('abd');

    await fillScratch(`scratch.innerHTML = '<input type="email" id="fresh-email">';`);
    const email = browser.$('#fresh-email');
    await email.addValue(`ab${Key.Backspace}c`);
    expect(await email.getValue()).toBe('ac');
  });

  it('should type the digit for a numpad key inside addValue', async () => {
    const input = browser.$('#keys-input');
    await input.addValue(`1${Key.Numpad2}`);
    expect(await input.getValue()).toBe('12');
  });

  it('should not type the null key', async () => {
    const input = browser.$('#keys-input');
    await input.addValue(`a${Key.NULL}b`);
    expect(await input.getValue()).toBe('ab');
    await input.addValue(Key.NULL);
    expect(await input.getValue()).toBe('ab');
  });

  it('should replace a selection made with Control+A in an input', async () => {
    const input = browser.$('#keys-input');
    await input.setValue('old');
    await input.addValue(`${Key.Control}a${Key.NULL}new`);
    expect(await input.getValue()).toBe('new');
  });

  it('should replace a selection made with Control+A in a contenteditable', async () => {
    await browser.execute('document.querySelector("#keys-editor").textContent = "old";');
    await browser.$('#keys-editor').addValue(`${Key.Control}a${Key.NULL}new`);
    expect(await editorText()).toBe('new');
  });

  it('should carry held modifiers on special keys', async () => {
    await browser.$('#key-target').addValue(`${Key.Shift}${Key.Enter}`);
    expect((await keyTargetEvents()).find((event) => event.key === 'Enter')).toMatchObject({ shiftKey: true });

    await browser.execute('window.__keyTargetEvents = [];');
    await browser.keys([Key.Shift, Key.PageDown]);
    expect((await keyTargetEvents()).find((event) => event.key === 'PageDown')).toMatchObject({ shiftKey: true });
  });

  it('should continue after existing contenteditable content', async () => {
    await browser.execute('document.querySelector("#keys-editor").textContent = "old";');
    await browser.$('#keys-editor').addValue(`new${Key.PageDown}`);
    expect(await editorText()).toBe('oldnew');
  });

  it('should type printable special keys into a contenteditable', async () => {
    await browser.$('#keys-editor').addValue(`a${Key.Space}b`);
    expect(await editorText()).toBe('a b');
  });

  it('should not type or delete in an input when the keydown is canceled', async () => {
    await browser.execute('document.querySelector("#keys-blocking-input").value = "ab";');
    const input = browser.$('#keys-blocking-input');
    await input.addValue(`c${Key.Space}`);
    expect(await input.getValue()).toBe('abc');
    await input.addValue(Key.Backspace);
    expect(await input.getValue()).toBe('abc');
    await browser.keys('x');
    await browser.keys('y');
    expect(await input.getValue()).toBe('abcy');
  });

  it('should not type in a contenteditable when the keydown is canceled', async () => {
    await browser.execute('document.querySelector("#keys-blocking-editor").textContent = "ab";');
    await browser.$('#keys-blocking-editor').addValue(`c${Key.Space}`);
    expect(await editorText('#keys-blocking-editor')).toBe('abc');
    await browser.keys('x');
    await browser.keys('y');
    expect(await editorText('#keys-blocking-editor')).toBe('abcy');
  });

  it('should keep Control held while the other hand still holds it', async () => {
    const input = browser.$('#keys-input');
    await input.setValue('old');
    await input.click();
    await browser
      .action('key')
      .down(Key.Control)
      .down(CONTROL_RIGHT)
      .up(CONTROL_RIGHT)
      .down('a')
      .up('a')
      .up(Key.Control)
      .perform();

    const selection = await browser.execute(
      'var el = document.querySelector("#keys-input"); return [el.value, el.selectionStart, el.selectionEnd];',
    );
    expect(selection).toEqual(['old', 0, 3]);
  });

  it('should keep typing after the existing text when a click focuses a field', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input id="fresh-input" value="old"><textarea id="fresh-textarea">old</textarea>';`,
    );
    await browser.$('#fresh-input').click();
    await browser.keys('x');
    expect(await browser.$('#fresh-input').getValue()).toBe('oldx');
    await browser.$('#fresh-textarea').click();
    await browser.keys('x');
    expect(await browser.$('#fresh-textarea').getValue()).toBe('oldx');
  });

  it('should not type into checkboxes or file inputs', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input type="checkbox" id="fresh-checkbox"><input type="file" id="fresh-file">';`,
    );
    await browser.$('#fresh-checkbox').click();
    await browser.keys(Key.Space);
    expect(await browser.$('#fresh-checkbox').getValue()).toBe('on');
    await browser.execute('document.querySelector("#fresh-file").focus();');
    expect(await errorOf(browser.keys(Key.Space))).toBeUndefined();
    expect((await errorOf(browser.$('#fresh-file').addValue('/tmp/upload.txt')))?.message).toMatch(/file/);
  });

  it('should refuse special keys when the element cannot take focus', async () => {
    await fillScratch(`scratch.innerHTML = '<div id="fresh-plain">plain</div>';`);
    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');
    const error = await errorOf(browser.$('#fresh-plain').addValue(Key.Enter));
    expect(error?.message).toMatch(/interactable/);
    expect(await keyTargetEvents()).toEqual([]);
  });

  it('should type into an input inside a shadow root', async () => {
    await fillScratch(
      `scratch.innerHTML = '<div id="fresh-host"></div><div id="fresh-delegating-host"></div>';
      document.querySelector("#fresh-host").attachShadow({ mode: "open" }).innerHTML = '<input id="shadow-input">';
      document.querySelector("#fresh-delegating-host")
        .attachShadow({ mode: "open", delegatesFocus: true }).innerHTML = '<input id="delegated-input" value="old">';`,
    );
    const input = browser.$('#fresh-host').shadow$('#shadow-input');
    await input.click();
    await browser.keys('x');
    await input.addValue(`a${Key.Backspace}b`);
    expect(await input.getValue()).toBe('xb');

    await browser.$('#fresh-delegating-host').addValue(`a${Key.Backspace}b`);
    expect(await browser.$('#fresh-delegating-host').shadow$('#delegated-input').getValue()).toBe('oldb');
  });

  it('should send plain text after the existing content of an unfocused contenteditable', async () => {
    await browser.execute('document.querySelector("#keys-editor").textContent = "old";');
    await browser.$('#keys-editor').addValue('new');
    expect(await editorText()).toBe('oldnew');

    await browser.execute(
      `document.querySelector("#keys-editor").innerHTML = '<p id="keys-editor-line">line</p>';
      document.activeElement.blur();`,
    );
    await browser.$('#keys-editor-line').addValue('s');
    expect(await editorText()).toBe('lines');
  });

  it('should append to a prefilled field that already has focus', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input id="fresh-focused" value="old">';
      document.querySelector("#fresh-focused").focus();`,
    );
    await browser.$('#fresh-focused').addValue(' more');
    expect(await browser.$('#fresh-focused').getValue()).toBe('old more');
  });

  it('should keep modifiers held across action calls', async () => {
    const input = browser.$('#keys-input');
    await input.setValue('old');
    try {
      await browser.action('key').down(Key.Control).perform(true);
      await browser.action('key').down('a').up('a').perform(true);
    } finally {
      await browser.releaseActions();
    }
    const selection = await browser.execute(
      'var el = document.querySelector("#keys-input"); return [el.value, el.selectionStart, el.selectionEnd];',
    );
    expect(selection).toEqual(['old', 0, 3]);

    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');
    try {
      await browser.action('key').down(Key.Shift).perform(true);
      await browser.action('key').down(Key.PageDown).up(Key.PageDown).perform(true);
    } finally {
      await browser.releaseActions();
    }
    expect((await keyTargetEvents()).find((event) => event.key === 'PageDown')).toMatchObject({ shiftKey: true });
  });

  it('should send the code, keyCode and Shift a browser sends for printable keys', async () => {
    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');
    await browser.keys(['a', 'A', 'p', '5', '!', ';', ':', "'", 'é']);
    const events = (await keyTargetEvents()).map(({ key, code, keyCode, shiftKey }) => ({
      key,
      code,
      keyCode,
      shiftKey,
    }));
    expect(events).toEqual([
      { key: 'a', code: 'KeyA', keyCode: 65, shiftKey: false },
      { key: 'A', code: 'KeyA', keyCode: 65, shiftKey: true },
      { key: 'p', code: 'KeyP', keyCode: 80, shiftKey: false },
      { key: '5', code: 'Digit5', keyCode: 53, shiftKey: false },
      { key: '!', code: 'Digit1', keyCode: 49, shiftKey: true },
      { key: ';', code: 'Semicolon', keyCode: 186, shiftKey: false },
      { key: ':', code: 'Semicolon', keyCode: 186, shiftKey: true },
      { key: "'", code: 'Quote', keyCode: 222, shiftKey: false },
      { key: 'é', code: '', keyCode: 0, shiftKey: false },
    ]);
  });

  it('should press Enter for a newline and Backspace for a backspace character, skip a carriage return, and type a tab', async () => {
    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');
    await browser.keys(['\n', '\r', '\b', '\t']);
    expect((await keyTargetEvents()).map(({ key, code, keyCode }) => ({ key, code, keyCode }))).toEqual([
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      { key: '\t', code: 'Tab', keyCode: 9 },
    ]);
    const input = browser.$('#keys-input');
    await input.setValue('ab\b\r\nc');
    expect(await input.getValue()).toBe('ac');
  });

  it('should fire input and change only when the value changes', async () => {
    const input = browser.$('#keys-input');
    await input.addValue(Key.NULL);
    await input.addValue(Key.PageDown);
    await browser.$('#key-target').click();
    expect(await keysInputEvents()).toEqual([]);
    await input.addValue('a');
    expect(await keysInputEvents()).toEqual([{ type: 'input', value: 'a' }]);
    await browser.$('#key-target').click();
    expect(await keysInputEvents()).toEqual([
      { type: 'input', value: 'a' },
      { type: 'change', value: 'a' },
    ]);
  });

  it('should fire change before blur when a click moves focus', async () => {
    await fillChangeScratch();
    const field = browser.$('#fresh-field');
    await field.addValue('ab');
    await field.addValue('c');
    expect(await fieldEvents()).toEqual(['input ab', 'input abc']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ab', 'input abc', 'change abc', 'blur abc']);
  });

  it('should fire change before blur when the page moves focus', async () => {
    await fillChangeScratch();
    await browser.$('#fresh-field').addValue('x');
    await browser.execute('document.querySelector("#fresh-other").focus()');
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should take focus off the field when a click lands on an element that cannot take it', async () => {
    await fillChangeScratch();
    await fillScratch(`scratch.insertAdjacentHTML("beforeend", '<div id="fresh-plain">plain</div>');`);
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-plain').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
    expect(await browser.execute('return document.activeElement === document.body')).toBe(true);
  });

  it('should fire change when an input handler moves focus on', async () => {
    await fillChangeScratch();
    await fillScratch(
      `document.querySelector("#fresh-field").addEventListener("input", function () {
        document.querySelector("#fresh-other").focus();
      });`,
    );
    await browser.$('#fresh-field').addValue('1');
    expect(await fieldEvents()).toEqual(['input 1', 'change 1', 'blur 1']);
  });

  it("should fire change when a click on the field's label takes focus from it, as a browser does", async () => {
    await fillChangeScratch();
    await fillScratch(
      `scratch.insertAdjacentHTML("beforeend", '<label id="fresh-label" for="fresh-field">label</label>');`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-label').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should focus the field a label points to only once', async () => {
    await fillChangeScratch();
    await fillScratch(
      `scratch.insertAdjacentHTML("beforeend", '<input id="fresh-b"><label id="fresh-b-label" for="fresh-b">b</label>');
      for (var type of ["focus", "blur"]) {
        document.querySelector("#fresh-b").addEventListener(type, function (ev) {
          window.__fieldEvents.push(ev.type + " b");
        });
      }`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-b-label').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x', 'focus b']);
  });

  it('should focus a contenteditable when a click lands inside it', async () => {
    await fillChangeScratch();
    await fillScratch(
      `scratch.insertAdjacentHTML("beforeend", '<div id="fresh-editor" contenteditable="true"><b id="fresh-bold">bold</b></div>');`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-bold').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
    expect(await browser.execute('return document.activeElement.id')).toBe('fresh-editor');
  });

  it('should take focus off the field when a click lands in a scrolling box', async () => {
    await fillChangeScratch();
    await fillScratch(
      `scratch.insertAdjacentHTML("beforeend", '<div style="overflow: auto; height: 20px"><p id="fresh-para">a</p><p>b</p><p>c</p></div>');`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-para').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
    expect(await browser.execute('return document.activeElement === document.body')).toBe(true);
  });

  it('should keep focus on a focused element when a click lands on its text', async () => {
    await fillScratch(
      `scratch.innerHTML = '<div id="fresh-panel" tabindex="-1"><p id="fresh-text">text</p></div>';
      document.querySelector("#fresh-panel").focus();`,
    );
    await browser.$('#fresh-text').click();
    expect(await browser.execute('return document.activeElement.id')).toBe('fresh-panel');
  });

  it("should leave a range input's value alone when clicking it", async () => {
    await fillScratch(
      `scratch.innerHTML = '<input id="fresh-range" type="range" min="0" max="100" value="10" style="width: 300px">';`,
    );
    await browser.$('#fresh-range').click();
    expect(await browser.$('#fresh-range').getValue()).toBe('10');
  });

  it("should let the page react to a click's press before its release, as real input does", async () => {
    await fillScratch(
      `scratch.innerHTML = '<button id="fresh-press">press</button>';
      var button = document.querySelector("#fresh-press");
      window.__pressReacted = false;
      button.addEventListener("pointerdown", function () {
        Promise.resolve().then(function () { window.__pressReacted = true; });
      });
      button.addEventListener("pointerup", function () { window.__releaseSawPress = window.__pressReacted; });`,
    );
    await browser.$('#fresh-press').click();
    expect(await browser.execute('return window.__releaseSawPress')).toBe(true);
  });

  it("should not start a window drag when clicking in Tauri's drag region", async () => {
    // Tauri's drag.js stops the mousedown of any drag it starts, so a mousedown reaching the window means no drag.
    await fillScratch(
      `scratch.innerHTML = '<div id="fresh-drag" data-tauri-drag-region>title</div>';
      window.__mousedownReachedWindow = false;
      window.addEventListener("mousedown", function () { window.__mousedownReachedWindow = true; }, { once: true });`,
    );
    await browser.$('#fresh-drag').click();
    expect(await browser.execute('return window.__mousedownReachedWindow')).toBe(true);
  });

  it('should keep focus in the field when the clicked element cancels its mousedown', async () => {
    await fillChangeScratch();
    await fillScratch(
      `var other = document.querySelector("#fresh-other");
      other.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      other.addEventListener("click", function () { window.__fieldEvents.push("click other"); });`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input x', 'click other']);
  });

  it('should leave focus where a click handler moves it', async () => {
    await fillChangeScratch();
    await fillScratch(
      `scratch.insertAdjacentHTML("beforeend", '<input id="fresh-target">');
      document.querySelector("#fresh-other").addEventListener("click", function () {
        document.querySelector("#fresh-target").focus();
      });`,
    );
    await browser.$('#fresh-other').click();
    expect(await browser.execute('return document.activeElement.id')).toBe('fresh-target');
  });

  it('should refuse to clear an element that is not editable', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input id="fresh-box" type="checkbox"><select id="fresh-select"><option>1</option></select>';`,
    );
    for (const selector of ['#fresh-box', '#fresh-select']) {
      expect((await errorOf(browser.$(selector).clearValue()))?.message).toMatch(/cannot be cleared/);
    }
  });

  it('should leave an empty field alone on Clear', async () => {
    await fillChangeScratch();
    await browser.$('#fresh-field').clearValue();
    expect(await fieldEvents()).toEqual([]);
  });

  it('should fire no change when the edits leave the value as it was', async () => {
    await fillChangeScratch();
    const field = browser.$('#fresh-field');
    await field.addValue('x');
    await field.addValue(Key.Backspace);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input x', 'input ', 'blur ']);
  });

  it('should clear with input, then change, then blur', async () => {
    await fillChangeScratch({ initialValue: 'old' });
    await browser.$('#fresh-field').clearValue();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ']);
  });

  it('should fire the change resulting from setValue when focus leaves', async () => {
    await fillChangeScratch({ initialValue: '1' });
    await browser.$('#fresh-field').setValue('2');
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2', 'blur 2']);
  });

  it('should fire change on Enter in an input, and not again when focus leaves', async () => {
    await fillChangeScratch();
    await browser.$('#fresh-field').addValue(`x${Key.Enter}`);
    expect(await fieldEvents()).toEqual(['input x', 'change x']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should fire the change resulting from setValue when Enter is pressed', async () => {
    await fillChangeScratch({ initialValue: '1' });
    await browser.$('#fresh-field').setValue('2');
    await browser.keys(Key.Enter);
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2', 'blur 2']);
  });

  it("should click the form's default button on Enter in an input, after its change, as Chrome does", async () => {
    await fillFormScratch('<input id="fresh-field"><button id="fresh-submit">go</button>');
    await browser.$('#fresh-field').addValue(`x${Key.Enter}`);
    expect(await fieldEvents()).toEqual([
      'keydown Enter',
      'change x',
      'click fresh-submit',
      'submit fresh-submit',
      'keyup Enter',
    ]);
  });

  it('should submit a form without a submit button on Enter only when it has a single text field', async () => {
    const pressEnter = async () => {
      await browser.execute('document.querySelector("#fresh-field").focus(); window.__fieldEvents = [];');
      await browser.keys(Key.Enter);
      return fieldEvents();
    };
    await fillFormScratch('<input id="fresh-field"><input type="checkbox"><input type="date">');
    expect(await pressEnter()).toEqual(['keydown Enter', 'submit without submitter', 'keyup Enter']);
    await fillFormScratch('<input id="fresh-field"><input type="password">');
    expect(await pressEnter()).toEqual(['keydown Enter', 'keyup Enter']);
  });

  it('should not submit the form when a keydown handler cancels Enter', async () => {
    await fillFormScratch('<input id="fresh-field"><button id="fresh-submit">go</button>');
    await browser.execute(
      'document.querySelector("#fresh-field").addEventListener("keydown", function (ev) { ev.preventDefault(); });',
    );
    await browser.$('#fresh-field').addValue(`x${Key.Enter}`);
    expect(await fieldEvents()).toEqual(['keydown Enter', 'keyup Enter']);
  });

  it('should not fire change when a click on the shadow host leaves the field focused', async () => {
    await fillChangeScratch({ inShadowHost: true });
    const host = browser.$('#fresh-host');
    await host.addValue('x');
    await host.click();
    expect(await fieldEvents()).toEqual(['input x']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should type line breaks and quotes from the actions API', async () => {
    await browser.$('#keys-textarea').click();
    await browser.keys(['a', NEWLINE, "'", 'b']);
    expect(await browser.$('#keys-textarea').getValue()).toBe(`a${NEWLINE}'b`);
  });

  it('should break lines on Enter in a textarea and a contenteditable only', async () => {
    await browser.$('#keys-textarea').addValue(`a${Key.Enter}b`);
    expect(await browser.$('#keys-textarea').getValue()).toBe(`a${NEWLINE}b`);

    await browser.$('#keys-editor').addValue(`a${Key.Enter}b`);
    const editorLines = (await browser.execute('return document.querySelector("#keys-editor").innerText')) as string;
    expect(editorLines.split(NEWLINE).filter(Boolean)).toEqual(['a', 'b']);

    await browser.$('#keys-input').addValue(`a${Key.Enter}b`);
    expect(await browser.$('#keys-input').getValue()).toBe('ab');
  });

  it('should move between radios whose group name needs escaping', async () => {
    await fillScratch(
      `for (var i = 1; i <= 3; i++) {
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "it" + String.fromCharCode(39) + "s";
        radio.id = "fresh-radio-" + i;
        scratch.appendChild(radio);
      }`,
    );
    await browser.$('#fresh-radio-1').click();
    await browser.keys(Key.ArrowDown);
    expect(await browser.$('#fresh-radio-2').isSelected()).toBe(true);

    await browser.$('#fresh-radio-1').click();
    await browser.$('#fresh-radio-1').addValue(`${Key.ArrowDown}${Key.ArrowDown}`);
    expect(await browser.$('#fresh-radio-3').isSelected()).toBe(true);
  });

  it('should let handlers outside a shadow root see its key and input events', async () => {
    await fillScratch(
      `scratch.innerHTML = '<div id="fresh-outer-host"></div>';
      var host = document.querySelector("#fresh-outer-host");
      host.attachShadow({ mode: "open" }).innerHTML = '<input id="shadow-input">';
      window.__hostEvents = [];
      for (var type of ["keydown", "input"]) {
        host.addEventListener(type, function (ev) {
          window.__hostEvents.push(ev.type);
        });
      }`,
    );
    const input = browser.$('#fresh-outer-host').shadow$('#shadow-input');
    await input.click();
    await browser.keys('x');
    expect(await input.getValue()).toBe('x');
    expect(await browser.execute('return window.__hostEvents')).toEqual(['keydown', 'input']);
  });

  it('should set the value of a date input directly', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input type="date" id="fresh-date"><input type="date" id="fresh-readonly-date" readonly>';
      window.__dateEvents = [];
      for (var type of ["input", "change"]) {
        document.querySelector("#fresh-date").addEventListener(type, function (ev) {
          window.__dateEvents.push(ev.type + " " + ev.target.value);
        });
      }`,
    );
    const date = browser.$('#fresh-date');
    await date.addValue('2026-10-21');
    expect(await date.getValue()).toBe('2026-10-21');
    expect(await browser.execute('return window.__dateEvents')).toEqual(['input 2026-10-21', 'change 2026-10-21']);
    await date.setValue('2027-01-02');
    expect(await date.getValue()).toBe('2027-01-02');
    await date.addValue(Key.ArrowUp);
    expect(await date.getValue()).toBe('2027-01-02');
    expect((await errorOf(date.addValue('not-a-date')))?.message).toMatch(/valid value/);
    expect(await date.getValue()).toBe('2027-01-02');
    expect((await errorOf(browser.$('#fresh-readonly-date').addValue('2026-10-21')))?.message).toMatch(/interactable/);
  });

  it('should keep the selection a focus handler makes when a click focuses a field', async () => {
    await fillScratch(
      `scratch.innerHTML = '<input id="fresh-select-on-focus" value="old">';
      document.querySelector("#fresh-select-on-focus").addEventListener("focus", function (ev) {
        ev.target.select();
      });`,
    );
    await browser.$('#fresh-select-on-focus').click();
    await browser.keys('x');
    expect(await browser.$('#fresh-select-on-focus').getValue()).toBe('x');
  });

  it('should send key events but leave the value of read-only fields alone', async () => {
    await fillScratch(
      `scratch.innerHTML = '<textarea id="fresh-readonly-area" readonly>old</textarea>' +
        '<input id="fresh-readonly-input" value="old" readonly><input id="fresh-disabled-input" value="old" disabled>';
      window.__readonlyKeys = [];
      document.querySelector("#fresh-readonly-area").addEventListener("keydown", function (ev) {
        window.__readonlyKeys.push(ev.key);
      });`,
    );
    const area = browser.$('#fresh-readonly-area');
    await area.addValue(`a${Key.Enter}${Key.Backspace}`);
    expect(await area.getValue()).toBe('old');
    expect(await browser.execute('return window.__readonlyKeys')).toEqual(['Enter', 'Backspace']);

    const input = browser.$('#fresh-readonly-input');
    await input.click();
    await browser.keys(['x', Key.Space, Key.Backspace]);
    expect(await input.getValue()).toBe('old');
    expect(await errorOf(input.clearValue())).toBeDefined();
    expect(await input.getValue()).toBe('old');

    const disabled = await browser.$('#fresh-disabled-input');
    expect((await errorOf(browser.elementSendKeys(disabled.elementId, 'x')))?.message).toMatch(/keyboard focus/);
    expect(await disabled.getValue()).toBe('old');
  });
});
