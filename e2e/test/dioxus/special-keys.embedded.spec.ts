import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

/**
 * Key actions through the embedded driver's own key mapping. The external provider hands keys to the
 * platform's WebDriver server, so wdio.dioxus.conf.ts excludes this suite.
 */

type KeyEvent = { key: string; code: string; keyCode: number; shiftKey: boolean };

async function keyTargetEvents() {
  return (await browser.execute('return window.__keyTargetEvents || []')) as unknown as KeyEvent[];
}

const NEWLINE = String.fromCharCode(10);

async function fillScratch(html: string) {
  await browser.execute(
    `var scratch = document.querySelector("#keys-scratch");
    if (!scratch) {
      scratch = document.createElement("div");
      scratch.id = "keys-scratch";
      document.body.appendChild(scratch);
    }
    scratch.innerHTML = '${html}';`,
  );
}

async function fieldValue(selector: string) {
  return browser.$(selector).getValue();
}

describe('Dioxus special keys (embedded)', () => {
  beforeEach(async () => {
    await browser.execute(
      `if (!document.querySelector("#key-target")) {
        var target = document.createElement("div");
        target.id = "key-target";
        target.tabIndex = -1;
        target.textContent = "Key target";
        target.addEventListener("keydown", function (ev) {
          window.__keyTargetEvents.push({ key: ev.key, code: ev.code, keyCode: ev.keyCode, shiftKey: ev.shiftKey });
        });
        document.body.appendChild(target);
      }`,
    );
    await browser.$('#key-target').click();
    await browser.execute('window.__keyTargetEvents = [];');
  });

  after(async () => {
    await browser.execute(
      'document.querySelector("#key-target").remove(); document.querySelector("#keys-scratch")?.remove();',
    );
  });

  it('should send the code and keyCode of special keys', async () => {
    await browser.keys([Key.PageDown, Key.Home, Key.Numpad1, Key.F1, Key.Return, Key.Enter]);
    expect((await keyTargetEvents()).map(({ key, code, keyCode }) => ({ key, code, keyCode }))).toEqual([
      { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      { key: 'Home', code: 'Home', keyCode: 36 },
      { key: '1', code: 'Numpad1', keyCode: 97 },
      { key: 'F1', code: 'F1', keyCode: 112 },
      { key: 'Enter', code: 'NumpadEnter', keyCode: 13 },
      { key: 'Enter', code: 'Enter', keyCode: 13 },
    ]);
  });

  it('should send the code, keyCode and Shift a browser sends for printable keys', async () => {
    await browser.keys(['a', 'A', 'p', '5', '!', ';', ':', "'", 'é']);
    expect(await keyTargetEvents()).toEqual([
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

  it('should send and type the shifted character while Shift is held, as Chrome does', async () => {
    await browser.keys([Key.Shift, 'a', '1', ';']);
    expect((await keyTargetEvents()).filter((event) => event.key !== 'Shift')).toEqual([
      { key: 'A', code: 'KeyA', keyCode: 65, shiftKey: true },
      { key: '!', code: 'Digit1', keyCode: 49, shiftKey: true },
      { key: ':', code: 'Semicolon', keyCode: 186, shiftKey: true },
    ]);

    await fillScratch('<input id="fresh-input">');
    await browser.$('#fresh-input').click();
    await browser.keys([Key.Shift, 'a', '1', ';']);
    expect(await fieldValue('#fresh-input')).toBe('A!:');
    await browser.$('#fresh-input').addValue(`${Key.Shift}b2/`);
    expect(await fieldValue('#fresh-input')).toBe('A!:B@?');
  });

  it('should press Enter for a newline, Backspace for a backspace character and Tab for a tab, and skip a carriage return', async () => {
    await browser.keys(['\n', '\r', '\b', '\t']);
    expect((await keyTargetEvents()).map(({ key, code, keyCode }) => ({ key, code, keyCode }))).toEqual([
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      { key: 'Tab', code: 'Tab', keyCode: 9 },
    ]);
  });

  it('should type and delete text in the focused field, firing input for each edit', async () => {
    await fillScratch('<input id="fresh-input" value="old">');
    await browser.execute(
      `window.__inputEvents = [];
      document.querySelector("#fresh-input").addEventListener("input", function (ev) {
        window.__inputEvents.push(ev.inputType + " " + ev.target.value);
      });`,
    );
    await browser.$('#fresh-input').click();
    await browser.keys(['a', 'B', Key.Backspace, '!']);
    expect(await fieldValue('#fresh-input')).toBe('olda!');
    expect(await browser.execute('return window.__inputEvents')).toEqual([
      'insertText olda',
      'insertText oldaB',
      'deleteContentBackward olda',
      'insertText olda!',
    ]);
  });

  it('should break lines on Enter in a textarea and a contenteditable only', async () => {
    await fillScratch(
      '<textarea id="fresh-textarea"></textarea><div id="fresh-editor" contenteditable="true"></div><input id="fresh-input">',
    );
    await browser.$('#fresh-textarea').click();
    await browser.keys(['a', Key.Enter, 'b']);
    expect(await fieldValue('#fresh-textarea')).toBe(`a${NEWLINE}b`);

    await browser.$('#fresh-editor').addValue('a');
    await browser.keys([Key.Enter, 'b']);
    const editorLines = (await browser.execute('return document.querySelector("#fresh-editor").innerText')) as string;
    expect(editorLines.split(NEWLINE).filter(Boolean)).toEqual(['a', 'b']);

    await browser.$('#fresh-input').click();
    await browser.keys(['a', Key.Enter, 'b']);
    expect(await fieldValue('#fresh-input')).toBe('ab');
  });

  it('should neither type nor delete when a keydown handler cancels the key', async () => {
    await fillScratch('<input id="fresh-input" value="ab">');
    await browser.execute(
      `document.querySelector("#fresh-input").addEventListener("keydown", function (ev) {
        if (ev.key !== "y") { ev.preventDefault(); }
      });`,
    );
    await browser.$('#fresh-input').click();
    await browser.keys(['x', Key.Backspace, 'y']);
    expect(await fieldValue('#fresh-input')).toBe('aby');
  });

  it('should replace the text Control+A selects', async () => {
    await fillScratch('<input id="fresh-input" value="old">');
    await browser.$('#fresh-input').click();
    await browser.keys([Key.Control, 'a']);
    await browser.keys('n');
    expect(await fieldValue('#fresh-input')).toBe('n');
  });

  it('should move between radio buttons on the arrow keys', async () => {
    await fillScratch(
      '<input type="radio" name="fresh-group" id="fresh-radio-1"><input type="radio" name="fresh-group" id="fresh-radio-2">',
    );
    await browser.$('#fresh-radio-1').click();
    await browser.keys(Key.ArrowDown);
    expect(await browser.$('#fresh-radio-2').isSelected()).toBe(true);
  });

  it('should press special keys inside addValue instead of typing them', async () => {
    await fillScratch('<input id="fresh-input"><input type="email" id="fresh-email">');
    await browser.$('#fresh-input').addValue(`abc${Key.Backspace}d${Key.PageDown}`);
    expect(await fieldValue('#fresh-input')).toBe('abd');
    await browser.$('#fresh-email').addValue(`ab${Key.Backspace}c`);
    expect(await fieldValue('#fresh-email')).toBe('ac');
  });

  it('should break lines on Enter inside addValue in a textarea', async () => {
    await fillScratch('<textarea id="fresh-textarea"></textarea>');
    await browser.$('#fresh-textarea').addValue(`a${Key.Enter}b`);
    expect(await fieldValue('#fresh-textarea')).toBe(`a${NEWLINE}b`);
  });

  it('should replace a selection made with Control+A inside addValue', async () => {
    await fillScratch('<input id="fresh-input" value="old">');
    await browser.$('#fresh-input').addValue(`${Key.Control}a${Key.NULL}new`);
    expect(await fieldValue('#fresh-input')).toBe('new');
  });
});
