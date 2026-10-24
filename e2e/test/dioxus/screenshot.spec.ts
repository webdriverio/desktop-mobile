import { browser, expect } from '@wdio/globals';

// IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte
// type, then width and height as big-endian uint32s.
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

function pngSize(base64: string) {
  const png = Buffer.from(base64, 'base64');
  return {
    signature: png.subarray(1, 4).toString('ascii'),
    width: png.readUInt32BE(IHDR_WIDTH_OFFSET),
    height: png.readUInt32BE(IHDR_HEIGHT_OFFSET),
  };
}

describe('Dioxus screenshots', () => {
  it('should capture the page natively rather than return a 1×1 placeholder', async () => {
    const title = await browser.$('#app-title');
    await expect(title).toBeDisplayed();

    const { signature, width, height } = pngSize(await browser.takeScreenshot());

    expect(signature).toBe('PNG');
    expect(width).toBeGreaterThan(1);
    expect(height).toBeGreaterThan(1);
  });
});
