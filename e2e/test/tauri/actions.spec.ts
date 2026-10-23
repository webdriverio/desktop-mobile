import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

import type { PageMouseEvent, PageMouseEventFields, PageWindow } from '../../lib/pageGlobals.js';

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

type PointerProbeWindow = PageWindow & {
  __pointerProbe?: { events: PageMouseEventFields[]; stop: () => void };
};

async function startPointerProbe({ cancel }: { cancel?: 'pointerdown' | 'pointermove' } = {}) {
  await browser.execute((canceledType?: string) => {
    const probeWindow = globalThis as unknown as PointerProbeWindow;
    probeWindow.__pointerProbe?.stop();
    const events: PageMouseEventFields[] = [];
    const types = ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click'];
    const record = (event: PageMouseEvent) => {
      const { type, pointerType, isPrimary, button, buttons } = event;
      // Hover moves are skipped so a real cursor resting over the window can't add noise.
      if (type.endsWith('move') && buttons === 0) {
        return;
      }
      if (type === canceledType) {
        event.preventDefault();
      }
      events.push({ type, pointerType, isPrimary, button, buttons });
    };
    for (const type of types) {
      probeWindow.document.addEventListener(type, record, true);
    }
    probeWindow.__pointerProbe = {
      events,
      stop: () => {
        for (const type of types) {
          probeWindow.document.removeEventListener(type, record, true);
        }
      },
    };
  }, cancel);
}

async function stopPointerProbe(): Promise<PageMouseEventFields[]> {
  const events: unknown = await browser.execute(() => {
    const probeWindow = globalThis as unknown as PointerProbeWindow;
    const probe = probeWindow.__pointerProbe;
    probe?.stop();
    delete probeWindow.__pointerProbe;
    return probe?.events ?? [];
  });
  return events as PageMouseEventFields[];
}

async function pressAt(x: number, y: number, button: 0 | 1 | 2 = 0) {
  await browser.action('pointer').move({ x, y, duration: 0 }).down({ button }).up({ button }).perform();
}

async function dragOutAndBack(x: number, y: number) {
  await browser
    .action('pointer')
    .move({ x, y, duration: 0 })
    .down()
    .move({ x: x + 10, y: y + 10, duration: 0 })
    .move({ x, y, duration: 0 })
    .up()
    .perform();
}

async function rightClickWhileLeftHeld(x: number, y: number) {
  await browser
    .action('pointer')
    .move({ x, y, duration: 0 })
    .down({ button: 0 })
    .down({ button: 2 })
    .up({ button: 2 })
    .up({ button: 0 })
    .perform();
}

const CHORDED_SEQUENCE = [
  'pointerdown',
  'mousedown',
  'pointermove',
  'mousedown',
  'pointermove',
  'mouseup',
  'pointerup',
  'mouseup',
  'click',
];

// The embedded driver synthesizes input in JS, so it must fire the PointerEvents real mouse input does.
describe('Embedded WebDriver pointer events', () => {
  before(function () {
    if (process.env.DRIVER_PROVIDER !== 'embedded') {
      this.skip();
    }
  });

  afterEach(async () => {
    await stopPointerProbe();
  });

  it('should dispatch a primary mouse pointerdown/pointerup before the compatibility mouse events', async () => {
    await startPointerProbe();

    await pressAt(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(events[0]).toMatchObject({ pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 });
    expect(events[2]).toMatchObject({ pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 });
  });

  it('should report the middle and right buttons in the DOM buttons bitmask', async () => {
    await startPointerProbe();

    await pressAt(5, 5, 1);
    await pressAt(5, 5, 2);

    const pointerDowns = (await stopPointerProbe()).filter(({ type }) => type === 'pointerdown');
    expect(pointerDowns).toMatchObject([
      { button: 1, buttons: 4 },
      { button: 2, buttons: 2 },
    ]);
  });

  it('should report held buttons and button -1 on pointermove during a drag', async () => {
    await startPointerProbe();

    await dragOutAndBack(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual([
      'pointerdown',
      'mousedown',
      'pointermove',
      'mousemove',
      'pointermove',
      'mousemove',
      'pointerup',
      'mouseup',
      'click',
    ]);
    expect(events.filter(({ type }) => type === 'pointermove')).toMatchObject([
      { button: -1, buttons: 1 },
      { button: -1, buttons: 1 },
    ]);
  });

  it('should suppress the compatibility mouse events, but not click, after a canceled pointerdown', async () => {
    await startPointerProbe({ cancel: 'pointerdown' });

    await dragOutAndBack(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual(['pointerdown', 'pointermove', 'pointermove', 'pointerup', 'click']);
  });

  it('should report a press and release of a second held button as pointermoves', async () => {
    await startPointerProbe();

    await rightClickWhileLeftHeld(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual(CHORDED_SEQUENCE);
    expect(events.filter(({ type }) => type === 'pointermove')).toMatchObject([
      { button: 2, buttons: 3 },
      { button: 2, buttons: 1 },
    ]);
  });

  it('should not suppress mouse events when a chorded pointermove is canceled', async () => {
    await startPointerProbe({ cancel: 'pointermove' });

    await rightClickWhileLeftHeld(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual(CHORDED_SEQUENCE);
  });
});
