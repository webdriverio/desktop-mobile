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
  wdioPress(el: HTMLElement): void;
  wdioRelease(el: HTMLElement): void;
  wdioFocusForClick(el: HTMLElement): void;
  wdioClearElement(el: HTMLElement): 'not editable' | 'empty' | 'cleared';
  wdioSetValueControl(el: HTMLElement, typed: string): 'immutable' | 'invalid' | 'set' | undefined;
};

const source = readFileSync(join(REPO_ROOT, TAURI_COPY), 'utf8');
const events = new Function(
  `${source}
  return { wdioRecordPendingChange, wdioTakePendingChange, wdioCommitOnEnter, wdioPress, wdioRelease, wdioFocusForClick, wdioClearElement, wdioSetValueControl };`,
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

// What Send Keys does to a text field: focus it, record the change it owes, and type.
function type(el: HTMLInputElement, text: string) {
  el.focus();
  events.wdioRecordPendingChange(el, el.value);
  el.value += text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  log = [];
}

// Stops `blur` reaching the page, as Chromium does on scripted focus moves while the window isn't
// focused.
function withoutBlur(run: () => void) {
  const stop = (event: Event) => event.stopImmediatePropagation();
  window.addEventListener('blur', stop, true);
  try {
    run();
  } finally {
    window.removeEventListener('blur', stop, true);
  }
}

// Element Click: the driver runs the press and the release as separate scripts.
function click(el: HTMLElement) {
  events.wdioPress(el);
  events.wdioRelease(el);
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

  it('should fire it when the driver next moves focus, if focus left the field without a blur', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['change a=x', 'focus b=']);
  });

  it('should fire it before the driver focuses the field again, if focus left it without a blur', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioClearElement($('#a'));
    expect(log).toEqual(['change a=x', 'focus a=x', 'input a=', 'change a=', 'blur a=']);
  });

  it.each([
    ['a click', () => events.wdioFocusForClick($('#b'))],
    ['a clear', () => events.wdioClearElement($('#b'))],
  ])('should fire it when %s moves focus without a blur', (_, run) => {
    $('#b').value = 'y';
    type($('#a'), 'x');
    withoutBlur(run);
    expect(log.filter((entry) => entry.startsWith('change a'))).toEqual(['change a=x']);
  });

  it('should fire nothing on a field the page has removed', () => {
    type($('#a'), 'x');
    $('#a').remove();
    events.wdioFocusForClick($('#b'));
    expect(log).toEqual(['focus b=']);
  });

  it('should fire it rather than drop it when another field records a change', () => {
    $('#a').value = 'x';
    events.wdioRecordPendingChange($('#a'), '');
    events.wdioRecordPendingChange($('#b'), '');
    expect(log).toEqual(['change a=x']);
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

describe('wdioPress and wdioRelease', () => {
  const CLICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  beforeEach(() => {
    render('<input id="a"><button id="b">b</button>');
    for (const name of CLICK_EVENTS) {
      $('#b').addEventListener(name, () => log.push(`${name} b`));
    }
  });

  it("should send a real click's events, moving focus as mousedown's default action", () => {
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual([
      'pointerdown b',
      'mousedown b',
      'change a=x',
      'blur a=x',
      'focus b=',
      'pointerup b',
      'mouseup b',
      'click b',
    ]);
  });

  it.each(['#d', '#inside'])(
    'should send %s, in a disabled control, pointer events but no mouse events or click, and still move focus',
    (selector) => {
      render('<input id="a"><div id="wrap"><button id="d" disabled><span id="inside">d</span></button></div>');
      for (const name of CLICK_EVENTS) {
        $('#wrap').addEventListener(name, () => log.push(name), true);
      }
      type($('#a'), 'x');
      click($(selector));
      expect(log).toEqual(['pointerdown', 'change a=x', 'blur a=x', 'pointerup']);
    },
  );

  it('should send no click to a control that a mouseup handler disables', () => {
    $('#b').addEventListener('mouseup', () => {
      ($('#b') as unknown as HTMLButtonElement).disabled = true;
    });
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'mousedown b', 'focus b=', 'pointerup b', 'mouseup b']);
  });

  it("should click a button that the click's own change enables", () => {
    render('<input id="a"><button id="save" disabled>save</button>');
    $('#a').addEventListener('change', () => {
      $('#save').disabled = false;
    });
    $('#save').addEventListener('click', () => log.push('click save'));
    type($('#a'), 'x');
    click($('#save'));
    expect(log).toEqual(['change a=x', 'blur a=x', 'click save']);
  });

  it('should leave focus where it is when the page cancels the mousedown', () => {
    $('#b').addEventListener('mousedown', (event) => event.preventDefault());
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'mousedown b', 'pointerup b', 'mouseup b', 'click b']);
    expect(document.activeElement).toBe($('#a'));
  });

  it('should send no mousedown or mouseup, and leave focus, when the page cancels the pointerdown', () => {
    $('#b').addEventListener('pointerdown', (event) => event.preventDefault());
    type($('#a'), 'x');
    click($('#b'));
    expect(log).toEqual(['pointerdown b', 'pointerup b', 'click b']);
    expect(document.activeElement).toBe($('#a'));
  });

  it('should leave focus where it is when the page cancels the mousedown and stops it there', () => {
    $('#b').addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    type($('#a'), 'x');
    click($('#b'));
    expect(document.activeElement).toBe($('#a'));
  });

  it("should shape the events as Chrome's are", () => {
    const shapes: string[] = [];
    for (const name of CLICK_EVENTS) {
      $('#b').addEventListener(name, (event) => {
        const { detail, pointerType } = event as PointerEvent;
        shapes.push(`${name} ${event.constructor.name} ${detail} ${pointerType}`);
      });
    }
    click($('#b'));
    expect(shapes).toEqual([
      'pointerdown PointerEvent 0 mouse',
      'mousedown MouseEvent 0 undefined',
      'pointerup PointerEvent 0 mouse',
      'mouseup MouseEvent 0 undefined',
      'click PointerEvent 1 mouse',
    ]);
  });

  it('should put the caret at the end of a text field before focusing it', () => {
    render('<input id="f" value="hello">');
    $('#f').setSelectionRange(0, 0);
    click($('#f'));
    expect([$('#f').selectionStart, document.activeElement]).toEqual([5, $('#f')]);
  });

  it("should leave a field's selection alone when the page cancels the mousedown", () => {
    render('<input id="f" value="hello">');
    $('#f').setSelectionRange(1, 3);
    $('#f').addEventListener('mousedown', (event) => event.preventDefault());
    click($('#f'));
    expect([$('#f').selectionStart, $('#f').selectionEnd]).toEqual([1, 3]);
  });

  it("should click through a component's own click()", () => {
    render('<div id="host"></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner">inner</button>';
    const inner = root.querySelector('#inner') as HTMLButtonElement;
    $('#host').click = () => inner.click();
    inner.addEventListener('click', () => log.push('click inner'));
    click($('#host'));
    expect(log).toEqual(['click inner']);
  });

  it('should click an SVG element, which has no click()', () => {
    render('<svg id="icon"></svg>');
    const icon = document.querySelector('#icon') as Element;
    icon.addEventListener('click', () => log.push('click icon'));
    click(icon as HTMLElement);
    expect(log).toEqual(['click icon']);
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

  it('should focus the shadow button a slotted label is shown in', () => {
    render('<div id="host"><span id="label">save</span></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner"><slot></slot></button>';
    events.wdioFocusForClick($('#label'));
    expect(root.activeElement).toBe(root.querySelector('#inner'));
  });

  it("should leave focus where a component's own focus() sends it", () => {
    render('<div id="host"><input id="inner"></div>');
    $('#host').focus = () => $('#inner').focus();
    events.wdioFocusForClick($('#host'));
    expect(document.activeElement).toBe($('#inner'));
  });

  it('should leave focus where a focus handler hands it back', () => {
    render('<div id="wrap" tabindex="-1"><input id="f"><span id="icon">icon</span></div>');
    $('#wrap').addEventListener('focus', () => $('#f').focus());
    type($('#f'), 'x');
    events.wdioFocusForClick($('#icon'));
    expect(document.activeElement).toBe($('#f'));
  });

  it("should leave focus in a component's field when its own focus() keeps it there", () => {
    render('<div id="wrap" tabindex="-1"><my-field id="host"></my-field></div>');
    const root = $('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="inner">';
    const inner = root.querySelector('#inner') as HTMLInputElement;
    $('#host').focus = () => inner.focus();
    type(inner, 'x');
    events.wdioFocusForClick($('#host'));
    expect(root.activeElement).toBe(inner);
  });

  it('should leave focus where a focus handler passes it', () => {
    render('<div id="bar" tabindex="0"><button id="item">item</button><span id="words">text</span></div>');
    $('#bar').addEventListener('focus', () => $('#item').focus());
    events.wdioFocusForClick($('#words'));
    expect(document.activeElement).toBe($('#item'));
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
    render(`<input id="d" type="date" value="2026-01-01"><input id="ro" type="date" readonly>
      <fieldset disabled><input id="fs" type="date"></fieldset><input id="t">`),
  );

  it('should set the value with input and change at once', () => {
    expect(events.wdioSetValueControl($('#d'), '2026-10-21')).toBe('set');
    expect(log).toEqual(['focus d=2026-01-01', 'input d=2026-10-21', 'change d=2026-10-21']);
  });

  it('should restore the value and report an invalid one', () => {
    expect(events.wdioSetValueControl($('#d'), 'not a date')).toBe('invalid');
    expect($('#d').value).toBe('2026-01-01');
  });

  it.each(['#ro', '#fs'])('should refuse %s as immutable', (selector) => {
    expect(events.wdioSetValueControl($(selector), '2026-10-21')).toBe('immutable');
  });

  it('should leave other elements, and empty text, to typing', () => {
    expect(events.wdioSetValueControl($('#t'), 'x')).toBeUndefined();
    expect(events.wdioSetValueControl($('#d'), '')).toBeUndefined();
    expect(log).toEqual([]);
  });
});
