// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

// jsdom has no delegatesFocus, so the E2E specs cover shadow hosts that keep focus.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/element-events.js';

type ElementEvents = {
  wdioRecordPendingChange(el: HTMLElement, value: string): void;
  wdioTakePendingChange(el?: HTMLElement): { el: HTMLElement; value: string } | undefined;
  wdioCommitOnEnter(el: HTMLElement): void;
  wdioFocusForClick(el: HTMLElement): void;
  wdioClearElement(el: HTMLElement): 'not editable' | 'empty' | 'cleared';
  wdioSetValueControl(el: HTMLElement, typed: string): 'immutable' | 'invalid' | 'set' | undefined;
};

const source = readFileSync(join(REPO_ROOT, TAURI_COPY), 'utf8');
const events = new Function(
  `${source}
  return { wdioRecordPendingChange, wdioTakePendingChange, wdioCommitOnEnter, wdioFocusForClick, wdioClearElement, wdioSetValueControl };`,
)() as ElementEvents;

let log: string[];

function $(selector: string) {
  return document.querySelector(selector) as HTMLInputElement;
}

// Logs each element's input, change, focus and blur events with its id and value.
function render(html: string) {
  document.body.innerHTML = html;
  log = [];
  for (const el of document.querySelectorAll<HTMLInputElement>('[id]')) {
    for (const type of ['input', 'change', 'focus', 'blur']) {
      el.addEventListener(type, () => log.push(`${type} ${el.id}${el.value === undefined ? '' : `=${el.value}`}`));
    }
  }
}

// What Send Keys does to a text field: focus it, type, and record the change it owes.
function type(el: HTMLInputElement, text: string) {
  el.focus();
  const before = el.value;
  el.value += text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  events.wdioRecordPendingChange(el, before);
  log = [];
}

beforeEach(() => {
  events.wdioTakePendingChange();
  (document.activeElement as HTMLElement | null)?.blur();
});

describe('pending change', () => {
  beforeEach(() => render('<input id="a"><input id="b">'));

  it('should fire change before blur however focus leaves the field', () => {
    type($('#a'), 'x');
    $('#b').focus();
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus b=']);
  });

  it('should fire no change when the value is back to what it was', () => {
    type($('#a'), 'x');
    $('#a').value = '';
    $('#a').blur();
    expect(log).toEqual(['blur a=']);
  });

  it('should keep the value from before the first edit', () => {
    type($('#a'), 'x');
    type($('#a'), 'y');
    $('#a').blur();
    expect(log).toEqual(['change a=xy', 'blur a=xy']);
  });

  it('should fire it only once', () => {
    type($('#a'), 'x');
    $('#a').blur();
    $('#a').focus();
    $('#a').blur();
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus a=x', 'blur a=x']);
  });

  it('should fire change before blur when focus moves inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="s"><button id="t">t</button>';
    const field = root.querySelector('#s') as HTMLInputElement;
    const shadowLog: string[] = [];
    field.addEventListener('change', () => shadowLog.push('change'));
    field.addEventListener('blur', () => shadowLog.push('blur'));
    field.focus();
    field.value = 'x';
    events.wdioRecordPendingChange(field, '');
    (root.querySelector('#t') as HTMLElement).focus();
    expect(shadowLog).toEqual(['change', 'blur']);
  });
});

describe('wdioCommitOnEnter', () => {
  beforeEach(() => render('<input id="a"><textarea id="t"></textarea>'));

  it('should fire the change an input owes, and none again when focus leaves', () => {
    type($('#a'), 'x');
    events.wdioCommitOnEnter($('#a'));
    $('#a').blur();
    expect(log).toEqual(['change a=x', 'blur a=x']);
  });

  it('should owe a change for edits after the Enter', () => {
    type($('#a'), 'x');
    events.wdioCommitOnEnter($('#a'));
    type($('#a'), 'y');
    $('#a').blur();
    expect(log).toEqual(['change a=xy', 'blur a=xy']);
  });

  it('should leave a textarea, or an unchanged input, owing nothing', () => {
    type($('#t'), 'x');
    events.wdioCommitOnEnter($('#t'));
    expect(log).toEqual([]);
    type($('#a'), '');
    events.wdioCommitOnEnter($('#a'));
    expect(log).toEqual([]);
  });
});

describe('wdioFocusForClick', () => {
  beforeEach(() =>
    render(`<input id="a"><button id="b"><span id="inner">b</span></button><div id="plain">plain</div>
      <label id="label" for="a">A</label><div id="box" tabindex="-1"><span id="text">text</span></div>`),
  );

  it('should move focus to the target, firing the owed change before blur', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['change a=x', 'blur a=x', 'focus b=']);
  });

  it('should focus the nearest focusable ancestor', () => {
    events.wdioFocusForClick($('#inner'));
    events.wdioFocusForClick($('#text'));
    expect(log).toEqual(['focus b=', 'blur b=', 'focus box']);
  });

  it('should take focus off the field when nothing there can take it', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#plain'));
    expect(log).toEqual(['change a=x', 'blur a=x']);
    expect(document.activeElement).toBe(document.body);
  });

  it("should take focus off the field when the click lands on the field's label", () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#label'));
    expect(log).toEqual(['change a=x', 'blur a=x']);
  });

  it("should take focus off a field in a shadow host that doesn't delegate focus", () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="s">';
    const field = root.querySelector('#s') as HTMLInputElement;
    const shadowLog: string[] = [];
    field.addEventListener('change', () => shadowLog.push('change'));
    field.addEventListener('blur', () => shadowLog.push('blur'));
    field.focus();
    field.value = 'x';
    events.wdioRecordPendingChange(field, '');
    events.wdioFocusForClick(host);
    expect(shadowLog).toEqual(['change', 'blur']);
  });

  it('should leave focus on a focused target', () => {
    type($('#a'), 'x');
    events.wdioFocusForClick($('#a'));
    expect(log).toEqual([]);
    expect(document.activeElement).toBe($('#a'));
  });
});

describe('wdioClearElement', () => {
  beforeEach(() =>
    render(`<input id="a" value="old"><input id="empty"><input id="ro" readonly value="r">
      <input id="dis" disabled value="d"><fieldset disabled><input id="fs" value="f"></fieldset>
      <input id="cb" type="checkbox"><select id="sel"><option>1</option></select><div id="div">text</div>`),
  );

  it.each(['#ro', '#dis', '#fs', '#cb', '#sel', '#div'])('should refuse %s as not editable', (selector) => {
    expect(events.wdioClearElement($(selector))).toBe('not editable');
    expect(log).toEqual([]);
  });

  it('should leave an empty field alone', () => {
    expect(events.wdioClearElement($('#empty'))).toBe('empty');
    expect(log).toEqual([]);
  });

  it('should focus, empty the field with input and change, then blur', () => {
    expect(events.wdioClearElement($('#a'))).toBe('cleared');
    expect(log).toEqual(['focus a=old', 'input a=', 'change a=', 'blur a=']);
  });

  it('should compare against the value from before Send Keys edited the field', () => {
    type($('#empty'), 'x');
    events.wdioClearElement($('#empty'));
    expect(log).toEqual(['input empty=', 'blur empty=']);
  });

  it('should fire the change another field owes before that field blurs', () => {
    type($('#empty'), 'x');
    events.wdioClearElement($('#a'));
    expect(log.slice(0, 3)).toEqual(['change empty=x', 'blur empty=x', 'focus a=old']);
  });
});

describe('wdioSetValueControl', () => {
  beforeEach(() =>
    render('<input id="d" type="date" value="2026-01-01"><input id="ro" type="date" readonly><input id="t">'),
  );

  it('should set the value with input and change at once', () => {
    expect(events.wdioSetValueControl($('#d'), '2026-10-21')).toBe('set');
    expect(log).toEqual(['focus d=2026-01-01', 'input d=2026-10-21', 'change d=2026-10-21']);
  });

  it('should restore the value and report an invalid one', () => {
    expect(events.wdioSetValueControl($('#d'), 'not a date')).toBe('invalid');
    expect($('#d').value).toBe('2026-01-01');
  });

  it('should refuse a read-only control', () => {
    expect(events.wdioSetValueControl($('#ro'), '2026-10-21')).toBe('immutable');
  });

  it('should leave other elements, and empty text, to typing', () => {
    expect(events.wdioSetValueControl($('#t'), 'x')).toBeUndefined();
    expect(events.wdioSetValueControl($('#d'), '')).toBeUndefined();
    expect(log).toEqual([]);
  });
});
