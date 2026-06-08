import { $, browser } from '@wdio/globals';

/**
 * Select a fixture element by its React Native `testID`, cross-platform.
 *
 * RN surfaces `testID` as the Android `resource-id` (UiAutomator2) and as the iOS
 * `accessibilityIdentifier` (XCUITest, reachable via the `~` accessibility-id selector).
 *
 * We deliberately select by `testID` rather than `accessibilityLabel`: on iOS an
 * accessibilityLabel shadows the element's value, so `getText()` on a value-bearing element
 * (e.g. the counter) would return the label ("counter") instead of the rendered text ("0").
 * `resourceIdMatches` tolerates an optional `pkg:id/` prefix on the Android resource id.
 */
export function el(testId: string) {
  return browser.isIOS ? $(`~${testId}`) : $(`android=new UiSelector().resourceIdMatches("(.*/)?${testId}")`);
}
