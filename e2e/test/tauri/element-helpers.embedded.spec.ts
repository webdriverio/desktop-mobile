import { browser, expect } from '@wdio/globals';

// The plugin's init script and a command's install-and-rerun after a miss each put the element helpers in the
// page, so a command passes if either works. Each test leaves only one of them to do it.
describe('element helpers (embedded)', () => {
  it('should install the helpers and run the command once when the page has lost them', async () => {
    await browser.execute(
      `document.querySelector("#keys-scratch").innerHTML = '<input id="fresh-field">';
      window.__fieldEvents = [];
      document.querySelector("#fresh-field").addEventListener("input", function (ev) {
        window.__fieldEvents.push(ev.type + " " + ev.target.value);
      });
      delete window.__wdio_element_events;`,
    );
    await browser.$('#fresh-field').addValue('x');
    expect(await browser.execute('return window.__fieldEvents')).toEqual(['input x']);
    expect(await browser.execute('return typeof window.__wdio_element_events')).toBe('object');
  });

  it('should install the helpers in a reloaded page before any element command', async () => {
    await browser.execute('window.__beforeReload = true; setTimeout(function () { location.reload(); });');
    await browser.waitUntil(
      async () =>
        (await browser.execute('return !window.__beforeReload && document.readyState === "complete"')) === true,
    );
    expect(await browser.execute('return typeof window.__wdio_element_events')).toBe('object');
  });
});
