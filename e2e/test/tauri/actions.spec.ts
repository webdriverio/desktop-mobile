import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

/**
 * `element.click(options)` routes through the W3C Actions API (performActions),
 * not the elementClick endpoint that bare `element.click()` uses. Both must land
 * on the same element.
 */
describe('W3C Actions API (click with options)', () => {
  it('click({}) lands on the same target as bare click()', async () => {
    const counter = await browser.$('#counter');
    const increment = await browser.$('#increment-button');
    const reset = await browser.$('#reset-button');

    await reset.click();
    await expect(counter).toHaveText('0');

    // Bare click() uses the elementClick endpoint — already worked.
    await increment.click();
    await expect(counter).toHaveText('1');

    // click({}) routes through performActions with an element origin; it must
    // land on the button, not viewport (0,0).
    await increment.click({});
    await expect(counter).toHaveText('2');
  });

  it('click({ button: "left" }) lands on the target', async () => {
    const counter = await browser.$('#counter');
    const increment = await browser.$('#increment-button');
    const reset = await browser.$('#reset-button');

    await reset.click();
    await expect(counter).toHaveText('0');

    await increment.click({ button: 'left' });
    await expect(counter).toHaveText('1');
  });
});
