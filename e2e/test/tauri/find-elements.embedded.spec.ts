import { $, browser, expect } from '@wdio/globals';

const COUNT = 8;
const ROUNDS = 5;
const indexes = Array.from({ length: COUNT }, (_, i) => i);

async function idsOf(elements: Iterable<WebdriverIO.Element>) {
  return Promise.all(Array.from(elements, (element) => element.getAttribute('id')));
}

// WebdriverIO's strict $() resolves each lookup with Find Elements, so lookups awaited together overlap in the driver.
describe('Tauri Find Elements - concurrent requests (embedded)', () => {
  before(async () => {
    await browser.execute((count) => {
      const items = (idPrefix: string) =>
        Array.from({ length: count }, (_, i) => `<span id="${idPrefix}-${i}" class="item-${i}">${i}</span>`).join('');
      const list = document.createElement('div');
      list.id = 'concurrent-list';
      list.innerHTML = items('list-item');
      const host = document.createElement('div');
      host.id = 'concurrent-shadow-host';
      host.attachShadow({ mode: 'open' }).innerHTML = items('shadow-item');
      document.body.append(list, host);
    }, COUNT);
  });

  after(async () => {
    await browser.execute(() => {
      document.querySelector('#concurrent-list')?.remove();
      document.querySelector('#concurrent-shadow-host')?.remove();
    });
  });

  it('should give each of two lazy $() lookups awaited together its own element', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const first = $('#concurrent-list .item-0');
      const second = $('#concurrent-list .item-1');

      expect(await Promise.all([first.getAttribute('id'), second.getAttribute('id')])).toEqual([
        'list-item-0',
        'list-item-1',
      ]);
    }
  });

  it('should give each concurrent $$() lookup its own elements', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const lists = await Promise.all(indexes.map((i) => browser.$$(`#concurrent-list .item-${i}`)));

      expect(await Promise.all(lists.map(idsOf))).toEqual(indexes.map((i) => [`list-item-${i}`]));
    }
  });

  it('should give each concurrent $$() lookup from an element its own elements', async () => {
    const list = await $('#concurrent-list');

    for (let round = 0; round < ROUNDS; round++) {
      const lists = await Promise.all(indexes.map((i) => list.$$(`.item-${i}`)));

      expect(await Promise.all(lists.map(idsOf))).toEqual(indexes.map((i) => [`list-item-${i}`]));
    }
  });

  it('should give each concurrent shadow$$() lookup its own elements', async () => {
    const host = await $('#concurrent-shadow-host');

    for (let round = 0; round < ROUNDS; round++) {
      const lists = await Promise.all(indexes.map((i) => host.shadow$$(`.item-${i}`)));

      expect(await Promise.all(lists.map(idsOf))).toEqual(indexes.map((i) => [`shadow-item-${i}`]));
    }
  });
});
