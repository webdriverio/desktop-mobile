import { expect, multiRemoteBrowser } from '@wdio/globals';

type EventLogWindow = Window & { __focusEvents?: string[] };

function instances() {
  const multi = multiRemoteBrowser as unknown as WebdriverIO.MultiRemoteBrowser;
  return [multi.getInstance('browserA'), multi.getInstance('browserB')];
}

function hasFocus(instance: WebdriverIO.Browser) {
  return instance.execute(() => document.hasFocus());
}

async function editAndLeaveField(instance: WebdriverIO.Browser) {
  await instance.execute(() => {
    document.querySelector('#focus-scratch')?.remove();
    const scratch = document.createElement('div');
    scratch.id = 'focus-scratch';
    scratch.innerHTML = '<input id="focus-field"><button id="focus-other">other</button>';
    document.body.append(scratch);
    const events: string[] = [];
    (window as EventLogWindow).__focusEvents = events;
    const field = scratch.querySelector('input') as HTMLInputElement;
    for (const type of ['input', 'change', 'blur', 'focusout']) {
      field.addEventListener(type, () => events.push(`${type} ${field.value}`));
    }
  });
  await instance.$('#focus-field').addValue('x');
  await instance.$('#focus-other').click();
  return instance.execute(() => (window as EventLogWindow).__focusEvents);
}

describe('Dioxus multiremote focus (embedded)', () => {
  before(function () {
    if (process.env.DRIVER_PROVIDER !== 'embedded') {
      this.skip();
    }
  });

  describe('WebView2 focus emulation', () => {
    before(function () {
      if (process.platform !== 'win32') {
        this.skip();
      }
    });

    // At most one of the windows has OS focus, so without emulation one page reports no focus.
    it('should report the page focused in both windows', async () => {
      expect(await Promise.all(instances().map(hasFocus))).toEqual([true, true]);
    });

    it('should fire change then blur in both windows once focus leaves an edited field', async () => {
      for (const instance of instances()) {
        expect(await editAndLeaveField(instance)).toEqual(['input x', 'change x', 'blur x', 'focusout x']);
      }
    });
  });

  describe('WebKitGTK window without focus', () => {
    before(function () {
      if (process.platform !== 'linux') {
        this.skip();
      }
    });

    // For WebKitGTK builds that skip `blur` here, test/scripts/element-events.spec.ts covers the `focusout`-only path.
    it('should fire change before blur once focus leaves an edited field', async () => {
      const all = instances();
      const focused = await Promise.all(all.map(hasFocus));
      expect(focused).toContain(false);

      for (const [index, instance] of all.entries()) {
        if (!focused[index]) {
          expect(await editAndLeaveField(instance)).toEqual(['input x', 'change x', 'blur x', 'focusout x']);
        }
      }
    });
  });
});
