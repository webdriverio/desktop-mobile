import { browser, expect } from '@wdio/globals';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const PROBE_ID = 'stale-element-probe';

async function addProbe(text: string) {
  await browser.execute(
    (id, content) => {
      const probe = document.createElement('p');
      probe.id = id;
      probe.textContent = content;
      document.querySelector(`#${id}`)?.remove();
      document.body.append(probe);
    },
    PROBE_ID,
    text,
  );
}

describe('Tauri stale elements (embedded)', () => {
  afterEach(async () => {
    await browser.execute((id) => document.querySelector(`#${id}`)?.remove(), PROBE_ID);
  });

  it('should report an element removed from the page as stale', async () => {
    await addProbe('old');
    const elementId = (await browser.findElement('css selector', `#${PROBE_ID}`))[ELEMENT_KEY];
    await browser.execute((id) => document.querySelector(`#${id}`)?.remove(), PROBE_ID);

    await expect(browser.getElementText(elementId)).rejects.toMatchObject({ name: 'stale element reference' });
  });

  it('should find an element again once the page replaces it', async () => {
    await addProbe('old');
    const probe = await browser.$(`#${PROBE_ID}`);
    expect(await probe.getText()).toBe('old');

    await addProbe('new');

    expect(await probe.getText()).toBe('new');
  });
});
