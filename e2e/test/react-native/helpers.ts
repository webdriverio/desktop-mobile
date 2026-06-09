import { $ } from '@wdio/globals';

/**
 * Select a fixture element by its stable id via the `~` (accessibility-id) selector — it matches
 * content-desc on Android and accessibilityIdentifier on iOS, both set by the fixture's `sel()`
 * (see App.tsx for the per-platform mapping + the iOS accessibilityLabel caveat).
 *
 * RN's testID does NOT surface as a queryable Android resource-id, so `~`/content-desc is the only
 * cross-platform option there.
 */
export function el(testId: string) {
  return $(`~${testId}`);
}
