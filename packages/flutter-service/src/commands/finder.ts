// browser.flutter.byValueKey / byText — Flutter widget find + tap/getText.
//
// Native find/tap runs through appium-flutter-driver in the FLUTTER context (we
// auto-switch to it). The finder descriptor matches appium-flutter-finder's shape (a
// JSON object the driver decodes); the real driver interaction is exercised by the e2e
// suite (PR4/PR5), where the exact `flutter:` command surface is pinned to the driver
// version in use.

import { switchWindow } from '@wdio/native-mobile-core';
import type { FlutterElement } from '@wdio/native-types';

const FLUTTER_CONTEXT = 'FLUTTER';

export type FlutterFinder =
  | { finderType: 'ByValueKey'; keyValueString: string; keyValueType: 'String' | 'int' }
  | { finderType: 'ByText'; text: string }
  | { finderType: 'ByType'; type: string };

export function byValueKeyFinder(key: string | number): FlutterFinder {
  return {
    finderType: 'ByValueKey',
    keyValueString: String(key),
    keyValueType: typeof key === 'number' ? 'int' : 'String',
  };
}

export function byTextFinder(text: string): FlutterFinder {
  return { finderType: 'ByText', text };
}

/** appium-flutter-finder serialises the descriptor to a JSON string used as the selector. */
export function serializeFinder(finder: FlutterFinder): string {
  return JSON.stringify(finder);
}

/** Build a tap/getText handle for a finder, auto-switching to the FLUTTER context first. */
export function createFlutterElement(browser: WebdriverIO.Browser, finder: FlutterFinder): FlutterElement {
  const selector = serializeFinder(finder);
  const inFlutterContext = async () => {
    await switchWindow(browser, FLUTTER_CONTEXT);
  };
  return {
    tap: async () => {
      await inFlutterContext();
      await browser.execute('flutter:waitFor', selector);
      await (await browser.$(selector)).click();
    },
    getText: async () => {
      await inFlutterContext();
      await browser.execute('flutter:waitFor', selector);
      return (await browser.$(selector)).getText();
    },
  };
}
