import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

async function errorOf(action: Promise<unknown>) {
  return action.then(
    () => undefined,
    (error: Error) => error,
  );
}

async function addToScratch(html: string) {
  await browser.execute(`document.querySelector("#change-scratch").insertAdjacentHTML("beforeend", '${html}')`);
}

async function fieldEvents() {
  return (await browser.execute('return window.__fieldEvents || []')) as unknown as string[];
}

// A field that logs input, change and blur with its value, next to a button to move focus to.
async function fillChangeScratch(initialValue = '') {
  await browser.execute(
    `var scratch = document.querySelector("#change-scratch") || (function () {
      var div = document.createElement("div");
      div.id = "change-scratch";
      document.body.appendChild(div);
      return div;
    })();
    scratch.innerHTML = '<input id="fresh-field" value="${initialValue}"><button id="fresh-other">other</button>';
    window.__fieldEvents = [];
    for (var type of ["input", "change", "blur"]) {
      document.querySelector("#fresh-field").addEventListener(type, function (ev) {
        window.__fieldEvents.push(ev.type + " " + ev.target.value);
      });
    }`,
  );
}

// A form holding `fields` that logs its key, change, click and submit events, and cancels its
// submit so the page stays.
async function fillFormScratch(fields: string) {
  await fillChangeScratch();
  await browser.execute(
    `document.querySelector("#change-scratch").innerHTML = '<form id="fresh-form">${fields}</form>';
    var form = document.querySelector("#fresh-form");
    window.__fieldEvents = [];
    for (var type of ["keydown", "keyup", "change", "click", "submit"]) {
      form.addEventListener(type, function (ev) {
        var detail = ev.type === "change" ? ev.target.value
          : ev.type === "submit" ? (ev.submitter ? ev.submitter.id : "without submitter")
          : ev.key || ev.target.id;
        window.__fieldEvents.push(ev.type + " " + detail);
      });
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); });`,
  );
}

describe('Dioxus element events (embedded)', () => {
  beforeEach(async () => {
    // Blur first, so a field's owed change fires before the scratch area is emptied.
    await browser.execute(
      'if (document.activeElement) { document.activeElement.blur(); }' +
        'var scratch = document.querySelector("#change-scratch");' +
        'if (scratch) { scratch.innerHTML = ""; }',
    );
  });

  it('should fire change once focus leaves a field Send Keys edited, before blur', async () => {
    await fillChangeScratch();
    const field = browser.$('#fresh-field');
    await field.addValue('ab');
    await field.addValue('c');
    expect(await fieldEvents()).toEqual(['input ab', 'input abc']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ab', 'input abc', 'change abc', 'blur abc']);
  });

  it('should fire change before blur when the page moves focus', async () => {
    await fillChangeScratch();
    await browser.$('#fresh-field').addValue('x');
    await browser.execute('document.querySelector("#fresh-other").focus()');
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should fire change when an input handler moves focus on', async () => {
    await fillChangeScratch();
    await browser.execute(
      'document.querySelector("#fresh-field").addEventListener("input", function () {' +
        'document.querySelector("#fresh-other").focus(); });',
    );
    await browser.$('#fresh-field').addValue('1');
    expect(await fieldEvents()).toEqual(['input 1', 'change 1', 'blur 1']);
  });

  it("should let the page react to a click's press before its release, as real input does", async () => {
    await fillChangeScratch();
    await browser.execute(
      `var button = document.querySelector("#fresh-other");
      window.__pressReacted = false;
      button.addEventListener("pointerdown", function () {
        Promise.resolve().then(function () { window.__pressReacted = true; });
      });
      button.addEventListener("pointerup", function () { window.__releaseSawPress = window.__pressReacted; });`,
    );
    await browser.$('#fresh-other').click();
    expect(await browser.execute('return window.__releaseSawPress')).toBe(true);
  });

  it('should take focus off the field when a click lands on an element that cannot take it', async () => {
    await fillChangeScratch();
    await addToScratch('<div id="fresh-plain">plain</div>');
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-plain').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
    expect(await browser.execute('return document.activeElement === document.body')).toBe(true);
  });

  it("should fire change when a click on the field's label takes focus from it, as a browser does", async () => {
    await fillChangeScratch();
    await addToScratch('<label id="fresh-label" for="fresh-field">label</label>');
    await browser.$('#fresh-field').addValue('x');
    await browser.$('#fresh-label').click();
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'blur x']);
  });

  it('should leave focus where a click handler moves it', async () => {
    await fillChangeScratch();
    await addToScratch('<input id="fresh-target">');
    await browser.execute(
      'document.querySelector("#fresh-other").addEventListener("click", function () {' +
        'document.querySelector("#fresh-target").focus(); });',
    );
    await browser.$('#fresh-other').click();
    expect(await browser.execute('return document.activeElement.id')).toBe('fresh-target');
  });

  it('should fire the change resulting from setValue when Enter is pressed', async () => {
    await fillChangeScratch('1');
    await browser.$('#fresh-field').setValue('2');
    await browser.keys(Key.Enter);
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2', 'blur 2']);
  });

  it("should click the form's default button on Enter in an input, after its change, as Chrome does", async () => {
    await fillChangeScratch();
    await browser.execute(
      `var form = document.createElement("form");
      form.innerHTML = '<button id="fresh-submit">go</button>';
      form.prepend(document.querySelector("#fresh-field"));
      document.querySelector("#change-scratch").appendChild(form);
      form.querySelector("#fresh-submit").addEventListener("click", function () {
        window.__fieldEvents.push("click");
      });
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        window.__fieldEvents.push("submit " + ev.submitter.id);
      });`,
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.keys(Key.Enter);
    expect(await fieldEvents()).toEqual(['input x', 'change x', 'click', 'submit fresh-submit']);
  });

  it('should submit a form in a shadow root on Enter in its input', async () => {
    await fillChangeScratch();
    await browser.execute(
      `var host = document.createElement("div");
      host.id = "fresh-host";
      document.querySelector("#change-scratch").appendChild(host);
      var root = host.attachShadow({ mode: "open", delegatesFocus: true });
      root.innerHTML = '<form><input id="inner"><button id="inner-submit">go</button></form>';
      root.querySelector("#inner").addEventListener("change", function (ev) {
        window.__fieldEvents.push("change inner " + ev.target.value);
      });
      root.querySelector("form").addEventListener("submit", function (ev) {
        ev.preventDefault();
        window.__fieldEvents.push("submit " + ev.submitter.id);
      });`,
    );
    await browser.$('#fresh-host').addValue('x');
    await browser.keys(Key.Enter);
    expect(await fieldEvents()).toEqual(['change inner x', 'submit inner-submit']);
  });

  it('should submit a form without a submit button on Enter only when it has a single text field', async () => {
    const pressEnter = async () => {
      await browser.execute('document.querySelector("#fresh-field").focus(); window.__fieldEvents = [];');
      await browser.keys(Key.Enter);
      return fieldEvents();
    };
    await fillFormScratch('<input id="fresh-field"><input type="checkbox"><input type="date">');
    expect(await pressEnter()).toEqual(['keydown Enter', 'submit without submitter', 'keyup Enter']);
    await fillFormScratch('<input id="fresh-field"><input type="password">');
    expect(await pressEnter()).toEqual(['keydown Enter', 'keyup Enter']);
  });

  it('should neither commit the change nor submit the form when a keydown handler cancels Enter', async () => {
    await fillFormScratch('<input id="fresh-field"><button id="fresh-submit">go</button>');
    await browser.execute(
      'document.querySelector("#fresh-field").addEventListener("keydown", function (ev) { ev.preventDefault(); });',
    );
    await browser.$('#fresh-field').addValue('x');
    await browser.keys(Key.Enter);
    expect(await fieldEvents()).toEqual(['keydown Enter', 'keyup Enter']);
  });

  it('should set a date input at once, firing input and change', async () => {
    await fillChangeScratch();
    await addToScratch('<input id="fresh-date" type="date">');
    await browser.execute(
      'window.__dateEvents = []; for (var type of ["input", "change"]) {' +
        'document.querySelector("#fresh-date").addEventListener(type, function (ev) {' +
        'window.__dateEvents.push(ev.type + " " + ev.target.value); }); }',
    );
    await browser.$('#fresh-date').setValue('2026-10-21');
    expect(await browser.execute('return window.__dateEvents')).toEqual(['input 2026-10-21', 'change 2026-10-21']);
  });

  it('should leave a read-only field alone, and refuse a disabled one', async () => {
    await fillChangeScratch();
    await addToScratch('<input id="fresh-readonly" readonly value="r"><input id="fresh-disabled" disabled>');
    await browser.$('#fresh-readonly').addValue('x');
    expect(await browser.$('#fresh-readonly').getValue()).toBe('r');
    expect((await errorOf(browser.$('#fresh-disabled').addValue('x')))?.message).toMatch(/interactable/);
  });

  it('should type into a contenteditable, and into an element inside one', async () => {
    await fillChangeScratch();
    await addToScratch('<div id="fresh-editor" contenteditable="true"><b id="fresh-bold">bold</b></div>');
    const editorText = () => browser.execute('return document.querySelector("#fresh-editor").textContent');
    await browser.$('#fresh-bold').addValue('er');
    expect(await editorText()).toBe('bolder');
    await browser.$('#fresh-editor').setValue('hello');
    expect(await editorText()).toBe('hello');
  });

  it('should type into the field a host delegates focus to, which then owes its change', async () => {
    await fillChangeScratch();
    await browser.execute(
      `var host = document.createElement("div");
      host.id = "fresh-host";
      document.querySelector("#change-scratch").appendChild(host);
      var root = host.attachShadow({ mode: "open", delegatesFocus: true });
      root.innerHTML = '<input id="inner">';
      for (var type of ["input", "change", "blur"]) {
        root.querySelector("#inner").addEventListener(type, function (ev) {
          window.__fieldEvents.push(ev.type + " inner " + ev.target.value);
        });
      }`,
    );
    await browser.$('#fresh-host').addValue('x');
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input inner x', 'change inner x', 'blur inner x']);
  });

  it('should clear with input, then change, then blur', async () => {
    await fillChangeScratch('old');
    await browser.$('#fresh-field').clearValue();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ']);
  });

  it('should leave an empty field alone on Clear', async () => {
    await fillChangeScratch();
    await browser.$('#fresh-field').clearValue();
    expect(await fieldEvents()).toEqual([]);
  });

  it('should refuse to clear an element that is not editable', async () => {
    await fillChangeScratch();
    await addToScratch('<input id="fresh-box" type="checkbox"><select id="fresh-select"><option>1</option></select>');
    for (const selector of ['#fresh-box', '#fresh-select']) {
      expect((await errorOf(browser.$(selector).clearValue()))?.message).toMatch(/cannot be cleared/);
    }
  });

  it('should leave the change for setValue until focus leaves', async () => {
    await fillChangeScratch('1');
    await browser.$('#fresh-field').setValue('2');
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2']);
    await browser.$('#fresh-other').click();
    expect(await fieldEvents()).toEqual(['input ', 'change ', 'blur ', 'input 2', 'change 2', 'blur 2']);
  });
});
