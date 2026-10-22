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
    await browser.execute(
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

  it('should fire input and change only when the value changes', async () => {
    const input = browser.$('#keys-input');
    await input.addValue(Key.NULL);
    await input.addValue(Key.PageDown);
    expect(await keysInputEvents()).toEqual([]);
    await input.addValue('a');
    expect(await keysInputEvents()).toEqual([
      { type: 'input', value: 'a' },
      { type: 'change', value: 'a' },
    ]);
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
