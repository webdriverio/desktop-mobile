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
    await browser.execute('document.querySelector("#key-target").remove()');
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

  it('should press Enter for a newline and Backspace for a backspace character, skip a carriage return, and send a tab as a character', async () => {
    await browser.keys(['\n', '\r', '\b', '\t']);
    expect((await keyTargetEvents()).map(({ key, code, keyCode }) => ({ key, code, keyCode }))).toEqual([
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      { key: '\t', code: 'Tab', keyCode: 9 },
    ]);
  });
});
