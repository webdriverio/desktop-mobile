import { expect } from '@wdio/globals';

describe('Dioxus asset bundling (package smoke)', () => {
  it('should apply the stylesheet dx bundled with asset!()', async () => {
    await expect(browser.$('#bundled-style')).toHaveStyle({ width: '48px' });
  });
});
