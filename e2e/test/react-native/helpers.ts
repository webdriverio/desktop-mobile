import { $ } from '@wdio/globals';

/**
 * Select a fixture element by its stable id via the `~` (accessibility-id) selector.
 *
 * The fixture (App.tsx `sel()`) exposes that id as **content-desc** on Android
 * (accessibilityLabel) and as **accessibilityIdentifier** on iOS (testID) — both of which `~`
 * matches. iOS deliberately omits accessibilityLabel: it would shadow a value-bearing element's
 * text, so getText() on the counter would return "counter" instead of the rendered number.
 *
 * (RN's testID does NOT surface as a queryable Android resource-id, so resource-id selection is
 * not an option there — content-desc is.)
 */
export function el(testId: string) {
  return $(`~${testId}`);
}
