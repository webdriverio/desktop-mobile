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

// The e2e tsconfig has no DOM lib, so the page realm is typed with local shapes (see lib/pageGlobals.ts).
type ProbedEvent = { type: string; pointerType?: string; isPrimary?: boolean; button: number; buttons: number };
type PageMouseEvent = ProbedEvent & { preventDefault(): void };
type PageListener = (event: PageMouseEvent) => void;
type ProbeWindow = {
  document: {
    addEventListener(type: string, listener: PageListener, capture: boolean): void;
    removeEventListener(type: string, listener: PageListener, capture: boolean): void;
  };
  __pointerProbe?: { events: ProbedEvent[]; stop: () => void };
};

async function startPointerProbe({ cancelPointerDown }: { cancelPointerDown: boolean }) {
  await browser.execute((cancel: boolean) => {
    const probeWindow = globalThis as unknown as ProbeWindow;
    probeWindow.__pointerProbe?.stop();
    const events: ProbedEvent[] = [];
    const types = ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click'];
    const record: PageListener = (event) => {
      const { type, pointerType, isPrimary, button, buttons } = event;
      // Hover moves are skipped so a real cursor resting over the window can't add noise.
      if (type.endsWith('move') && buttons === 0) {
        return;
      }
      if (cancel && type === 'pointerdown') {
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
  }, cancelPointerDown);
}

async function stopPointerProbe(): Promise<ProbedEvent[]> {
  const events: unknown = await browser.execute(() => {
    const probeWindow = globalThis as unknown as ProbeWindow;
    const probe = probeWindow.__pointerProbe;
    probe?.stop();
    delete probeWindow.__pointerProbe;
    return probe?.events ?? [];
  });
  return events as ProbedEvent[];
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

/**
 * The embedded driver synthesizes input in JS, so it has to dispatch the PointerEvents a browser
 * fires for real mouse input; components that dismiss on an outside `pointerdown` rely on them.
 */
describe('Embedded WebDriver pointer events', () => {
  before(function () {
    if (process.env.DRIVER_PROVIDER !== 'embedded') {
      this.skip();
    }
  });

  afterEach(async () => {
    await stopPointerProbe();
  });

  it('dispatches a primary mouse pointerdown/pointerup before the compatibility mouse events', async () => {
    await startPointerProbe({ cancelPointerDown: false });

    await pressAt(5, 5);

    const events = await stopPointerProbe();
    expect(events.map(({ type }) => type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(events[0]).toMatchObject({ pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 });
    expect(events[2]).toMatchObject({ pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 });
  });

  it('reports the middle and right buttons in the DOM buttons bitmask', async () => {
    await startPointerProbe({ cancelPointerDown: false });

    await pressAt(5, 5, 1);
    await pressAt(5, 5, 2);

    const pointerDowns = (await stopPointerProbe()).filter(({ type }) => type === 'pointerdown');
    expect(pointerDowns).toMatchObject([
      { button: 1, buttons: 4 },
      { button: 2, buttons: 2 },
    ]);
  });

  it('reports held buttons and button -1 on pointermove during a drag', async () => {
    await startPointerProbe({ cancelPointerDown: false });

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

  it('suppresses the compatibility mouse events, but not click, after a canceled pointerdown', async () => {
    await startPointerProbe({ cancelPointerDown: true });

    await dragOutAndBack(5, 5);

    const canceledPress = await stopPointerProbe();
    expect(canceledPress.map(({ type }) => type)).toEqual([
      'pointerdown',
      'pointermove',
      'pointermove',
      'pointerup',
      'click',
    ]);

    // The suppression ends with the press, so the next one fires mouse events again.
    await startPointerProbe({ cancelPointerDown: false });

    await pressAt(5, 5);

    const nextPress = await stopPointerProbe();
    expect(nextPress.map(({ type }) => type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });
});
