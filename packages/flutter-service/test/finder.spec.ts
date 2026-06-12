import { describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/native-mobile-core', () => ({ switchContext: vi.fn().mockResolvedValue(undefined) }));

import { switchContext } from '@wdio/native-mobile-core';

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

  it('serializeFinder base64-encodes the descriptor (appium-flutter-finder format)', () => {
    const encoded = serializeFinder(byTextFinder('x'));
    expect(encoded).toBe(Buffer.from('{"finderType":"ByText","text":"x"}').toString('base64'));
    expect(Buffer.from(encoded, 'base64').toString()).toBe('{"finderType":"ByText","text":"x"}');
  });
});

describe('createFlutterElement', () => {
  const makeBrowser = () => {
    // No `$`/findElement — appium-flutter-driver doesn't implement it; the finder is the element id
    // passed straight to the element commands.
    const browser = {
      execute: vi.fn().mockResolvedValue(undefined),
      elementClick: vi.fn().mockResolvedValue(undefined),
      getElementText: vi.fn().mockResolvedValue('42'),
    } as unknown as WebdriverIO.Browser;
    return { browser };
  };

  it('tap() should switch to the FLUTTER context, wait, and click via the finder element id', async () => {
    (switchContext as ReturnType<typeof vi.fn>).mockClear();
    const { browser } = makeBrowser();
    await createFlutterElement(browser, byValueKeyFinder('inc')).tap();
    expect(switchContext).toHaveBeenCalledWith(browser, 'FLUTTER');
    expect(browser.execute).toHaveBeenCalledWith('flutter:waitFor', serializeFinder(byValueKeyFinder('inc')));
    expect(browser.elementClick).toHaveBeenCalledWith(serializeFinder(byValueKeyFinder('inc')));
  });

  it('getText() should switch context, wait, and read the text via the finder element id', async () => {
    (switchContext as ReturnType<typeof vi.fn>).mockClear();
    const { browser } = makeBrowser();
    expect(await createFlutterElement(browser, byTextFinder('Counter')).getText()).toBe('42');
    expect(switchContext).toHaveBeenCalledWith(browser, 'FLUTTER');
    expect(browser.execute).toHaveBeenCalledWith('flutter:waitFor', serializeFinder(byTextFinder('Counter')));
    expect(browser.getElementText).toHaveBeenCalledWith(serializeFinder(byTextFinder('Counter')));
  });
});
