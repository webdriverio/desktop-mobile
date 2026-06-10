import { describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-mobile-core', () => ({ switchWindow: vi.fn().mockResolvedValue(undefined) }));

import { switchWindow } from '@wdio/native-mobile-core';

import { byTextFinder, byValueKeyFinder, createFlutterElement, serializeFinder } from '../src/commands/finder.js';

describe('finder descriptors', () => {
  it('byValueKeyFinder builds a String ByValueKey', () => {
    expect(byValueKeyFinder('counter')).toEqual({
      finderType: 'ByValueKey',
      keyValueString: 'counter',
      keyValueType: 'String',
    });
  });

  it('byValueKeyFinder marks an int key', () => {
    expect(byValueKeyFinder(5)).toEqual({ finderType: 'ByValueKey', keyValueString: '5', keyValueType: 'int' });
  });

  it('byTextFinder builds a ByText descriptor', () => {
    expect(byTextFinder('Hello')).toEqual({ finderType: 'ByText', text: 'Hello' });
  });

  it('serializeFinder JSON-encodes the descriptor', () => {
    expect(serializeFinder(byTextFinder('x'))).toBe('{"finderType":"ByText","text":"x"}');
  });
});

describe('createFlutterElement', () => {
  const makeBrowser = () => {
    const element = { click: vi.fn().mockResolvedValue(undefined), getText: vi.fn().mockResolvedValue('42') };
    const browser = {
      execute: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(element),
    } as unknown as WebdriverIO.Browser;
    return { browser, element };
  };

  it('tap() should switch to the FLUTTER context, wait, and click', async () => {
    (switchWindow as ReturnType<typeof vi.fn>).mockClear();
    const { browser, element } = makeBrowser();
    await createFlutterElement(browser, byValueKeyFinder('inc')).tap();
    expect(switchWindow).toHaveBeenCalledWith(browser, 'FLUTTER');
    expect(browser.execute).toHaveBeenCalledWith('flutter:waitFor', expect.stringContaining('ByValueKey'));
    expect(element.click).toHaveBeenCalled();
  });

  it('getText() should switch context, wait, and read the text', async () => {
    (switchWindow as ReturnType<typeof vi.fn>).mockClear();
    const { browser, element } = makeBrowser();
    expect(await createFlutterElement(browser, byTextFinder('Counter')).getText()).toBe('42');
    expect(switchWindow).toHaveBeenCalledWith(browser, 'FLUTTER');
    expect(browser.execute).toHaveBeenCalledWith('flutter:waitFor', expect.stringContaining('ByText'));
    expect(element.getText).toHaveBeenCalled();
  });
});
