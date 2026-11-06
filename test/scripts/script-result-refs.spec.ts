// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STASH_NODES_JS } from '../../packages/electrobun-service/src/commands/stashNodes.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/script-result-refs.js';
const DIOXUS_COPY = 'packages/dioxus-embedded-driver/src/server/handlers/script-result-refs.js';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type ScriptResultRefs = {
  discard(first: number): void;
  listOf(value: unknown): unknown[] | undefined;
  nodeRef(value: unknown): Record<string, string> | undefined;
  withRefs(value: unknown): unknown;
};

const source = readFileSync(join(REPO_ROOT, TAURI_COPY), 'utf8');
const scriptResultRefs = new Function(`${source}\nreturn __wdioScriptResultRefs;`)() as (
  idPrefix: string,
  varPrefix: string,
) => ScriptResultRefs;

const page = window as unknown as Record<string, unknown>;
let refs: ScriptResultRefs;

beforeEach(() => {
  document.body.innerHTML = '<div id="first"></div><div id="second"></div><div id="host"></div>';
  refs = scriptResultRefs('5f0c-11e4', '__test_el_');
});

afterEach(() => {
  for (const name of Object.keys(page).filter((key) => key.startsWith('__test_el_'))) {
    delete page[name];
  }
});

function byId(id: string) {
  return document.getElementById(id) as HTMLElement;
}

function formWithInput() {
  const form = document.createElement('form');
  form.innerHTML = '<input name="a">';
  return form;
}

function selectWithOption() {
  const select = document.createElement('select');
  select.innerHTML = '<option>a</option>';
  return select;
}

describe('script-result-refs.js', () => {
  it('should be the same in both embedded driver crates', () => {
    expect(readFileSync(join(REPO_ROOT, DIOXUS_COPY), 'utf8'), `copy ${TAURI_COPY} over ${DIOXUS_COPY}`).toBe(source);
  });

  describe('nodeRef', () => {
    it('should return an element reference and keep the element where its ID points', () => {
      const el = byId('first');

      expect(refs.nodeRef(el)).toEqual({ [ELEMENT_KEY]: '5f0c-11e4-0' });
      expect(page.__test_el_5f0c11e40).toBe(el);
    });

    it('should return a shadow root reference for a shadow root', () => {
      const shadow = byId('host').attachShadow({ mode: 'open' });

      expect(refs.nodeRef(shadow)).toEqual({ [SHADOW_KEY]: '5f0c-11e4-0' });
      expect(page.__test_el_5f0c11e40).toBe(shadow);
    });

    it('should return an element reference for a callable element, as Chromium makes embed and object', () => {
      const callable = Object.assign(() => undefined, { nodeType: 1, nodeName: 'EMBED' });

      expect(refs.nodeRef(callable)).toEqual({ [ELEMENT_KEY]: '5f0c-11e4-0' });
      expect(page.__test_el_5f0c11e40).toBe(callable);
    });

    it('should leave a plain function alone', () => {
      expect(refs.nodeRef(() => undefined)).toBeUndefined();
    });

    it('should number the nodes in the order it meets them', () => {
      expect(refs.nodeRef(byId('first'))).toEqual({ [ELEMENT_KEY]: '5f0c-11e4-0' });
      expect(refs.nodeRef(byId('second'))).toEqual({ [ELEMENT_KEY]: '5f0c-11e4-1' });
    });

    it.each([
      ['a text node', () => document.createTextNode('text')],
      ['a fragment that is not a shadow root', () => document.createDocumentFragment()],
      ['a plain object', () => ({ id: 'first' })],
      ['null', () => null],
      ['a string', () => 'first'],
    ])('should return undefined for %s', (_name, value) => {
      expect(refs.nodeRef(value())).toBeUndefined();
    });
  });

  describe('listOf', () => {
    it('should return the nodes of a NodeList and an HTMLCollection as arrays', () => {
      const [first, second] = [byId('first'), byId('second')];

      expect(refs.listOf(document.querySelectorAll('#first, #second'))).toEqual([first, second]);
      expect(refs.listOf(document.getElementsByTagName('div'))).toEqual([first, second, byId('host')]);
    });

    it('should return a NodeList from another frame as an array', () => {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const frameDocument = frame.contentDocument as Document;
      frameDocument.body.innerHTML = '<p></p><p></p>';
      const paragraphs = frameDocument.querySelectorAll('p');

      expect(paragraphs instanceof NodeList).toBe(false);
      expect(refs.listOf(paragraphs)).toEqual(Array.from(paragraphs));
    });

    it('should return any other iterable object with a numeric length as an array', () => {
      expect(refs.listOf(new Uint8Array([1, 2]))).toEqual([1, 2]);
    });

    it('should copy a collection by index up to its length, not through its iterator', () => {
      const collection = {
        0: 'a',
        1: 'b',
        length: 2,
        *[Symbol.iterator]() {
          yield* ['x', 'y', 'z'];
        },
      };

      expect(refs.listOf(collection)).toEqual(['a', 'b']);
    });

    it.each([
      ['an array', () => [byId('first')]],
      ['an element', () => byId('first')],
      ['a form element, which is iterable', () => formWithInput()],
      ['a select element, which is iterable', () => selectWithOption()],
      ['a plain object keyed by index', () => ({ 0: byId('first'), length: 1 })],
      ['a string', () => 'ab'],
    ])('should return undefined for %s', (_name, value) => {
      expect(refs.listOf(value())).toBeUndefined();
    });
  });

  describe('discard', () => {
    it('should drop the nodes kept for the references from the given number up', () => {
      refs.nodeRef(byId('first'));
      refs.nodeRef(byId('second'));

      refs.discard(1);

      expect(page.__test_el_5f0c11e40).toBe(byId('first'));
      expect('__test_el_5f0c11e41' in page).toBe(false);
    });
  });

  describe('withRefs', () => {
    it('should replace elements at the top level, in arrays and in objects', () => {
      const [first, second] = [byId('first'), byId('second')];

      expect(refs.withRefs(first)).toEqual({ [ELEMENT_KEY]: '5f0c-11e4-0' });
      expect(refs.withRefs([first, second])).toEqual([
        { [ELEMENT_KEY]: '5f0c-11e4-1' },
        { [ELEMENT_KEY]: '5f0c-11e4-2' },
      ]);
      expect(refs.withRefs({ counter: { el: second } })).toEqual({ counter: { el: { [ELEMENT_KEY]: '5f0c-11e4-3' } } });
      expect(page.__test_el_5f0c11e43).toBe(second);
    });

    it('should send a NodeList or HTMLCollection as an array, at the top level and nested', () => {
      expect(refs.withRefs(document.querySelectorAll('#first, #second'))).toEqual([
        { [ELEMENT_KEY]: '5f0c-11e4-0' },
        { [ELEMENT_KEY]: '5f0c-11e4-1' },
      ]);
      expect(refs.withRefs({ found: document.getElementsByClassName('missing') })).toEqual({ found: [] });
      expect(refs.withRefs({ divs: document.getElementsByTagName('div') })).toEqual({
        divs: [{ [ELEMENT_KEY]: '5f0c-11e4-2' }, { [ELEMENT_KEY]: '5f0c-11e4-3' }, { [ELEMENT_KEY]: '5f0c-11e4-4' }],
      });
    });

    it('should send a form element as a reference, not as a list of its controls', () => {
      expect(refs.withRefs({ form: formWithInput() })).toEqual({ form: { [ELEMENT_KEY]: '5f0c-11e4-0' } });
    });

    it('should send the rest of a result with nodes as JSON.stringify does', () => {
      const result = { el: byId('first'), when: new Date(0), missing: undefined, nan: Number.NaN, list: [undefined] };

      expect(refs.withRefs(result)).toEqual({
        el: { [ELEMENT_KEY]: '5f0c-11e4-0' },
        when: '1970-01-01T00:00:00.000Z',
        nan: null,
        list: [null],
      });
    });

    it('should return a result with no nodes as it is', () => {
      const result = { when: new Date(0), list: [1, 'two'] };

      expect(refs.withRefs(result)).toBe(result);
      expect(refs.withRefs(undefined)).toBeUndefined();
    });

    it('should return a result JSON.stringify rejects as it is, and drop only the nodes it kept', () => {
      const cycleRefs = scriptResultRefs('cycle', '__test_el_');
      const cyclic: Record<string, unknown> = { el: byId('first') };
      cyclic.self = cyclic;
      cycleRefs.nodeRef(byId('second'));

      expect(cycleRefs.withRefs(cyclic)).toBe(cyclic);
      expect(page.__test_el_cycle0).toBe(byId('second'));
      expect('__test_el_cycle1' in page).toBe(false);
    });
  });
});

// Electrobun's page-side stash keeps the nodes in one array behind placeholders instead of under IDs, so it
// can't be a copy of the file. It must still turn every result into the same shape with the same nodes.
describe("Electrobun's page-side stash", () => {
  const stashNodes = new Function(`${STASH_NODES_JS}\nreturn __wdioStashNodes;`)() as (
    value: unknown,
    stash: string,
    mark: string,
  ) => unknown;
  const STASH = '__test_stash';
  const MARK = '__test_mark';

  afterEach(() => {
    delete page[STASH];
  });

  // Each reference becomes `{ ref: node }`, so the outputs compare by which node sits where, and a node
  // left in the result unreplaced doesn't pass for one that was
  function withNodes(value: unknown, nodeOf: (ref: Record<string, unknown>) => unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => withNodes(item, nodeOf));
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    const node = nodeOf(value as Record<string, unknown>);
    if (node !== undefined) {
      return { ref: node };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNodes(item, nodeOf)]));
  }

  function fromDrivers(value: unknown) {
    const result = refs.withRefs(value);
    return result === value
      ? value
      : withNodes(result, (ref) => {
          const id = ref[ELEMENT_KEY] ?? ref[SHADOW_KEY];
          return typeof id === 'string' ? page[`__test_el_${id.replace(/-/g, '')}`] : undefined;
        });
  }

  function fromElectrobun(value: unknown) {
    const result = stashNodes(value, STASH, MARK) as Record<string, unknown> | undefined;
    if (result === value || typeof result?.[MARK] !== 'number') {
      return result;
    }
    return withNodes(result.value, (ref) =>
      typeof ref[MARK] === 'number' ? (page[STASH] as unknown[])[ref[MARK] as number] : undefined,
    );
  }

  it.each([
    ['an element', () => byId('first')],
    ['the same element twice', () => [byId('first'), { again: byId('first') }]],
    ['a shadow root', () => byId('host').attachShadow({ mode: 'open' })],
    ['a callable element', () => [Object.assign(() => undefined, { nodeType: 1, nodeName: 'EMBED' })]],
    ['a plain function', () => [() => undefined]],
    ['a NodeList', () => document.querySelectorAll('#first, #second')],
    ['an HTMLCollection, nested', () => ({ divs: document.getElementsByTagName('div') })],
    ['an empty list', () => ({ found: document.getElementsByClassName('missing') })],
    ['a form element', () => ({ form: formWithInput() })],
    ['a select element', () => [selectWithOption()]],
    ['a fragment that is not a shadow root', () => [document.createDocumentFragment()]],
    ['a text node', () => [document.createTextNode('text')]],
    ['a typed array', () => new Uint8Array([1, 2])],
    ['a plain object keyed by index', () => ({ 0: byId('first'), length: 1 })],
    ['the rest of a result with nodes', () => ({ el: byId('first'), when: new Date(0), nan: Number.NaN })],
    ['a result with no nodes', () => ({ when: new Date(0), list: [1, 'two'] })],
  ])('should turn %s into what the embedded drivers send', (_name, make) => {
    const value = make();

    expect(fromElectrobun(value)).toEqual(fromDrivers(value));
  });

  it('should return a result JSON.stringify rejects as it is, as the embedded drivers do', () => {
    const cyclic: Record<string, unknown> = { el: byId('first') };
    cyclic.self = cyclic;

    expect(fromElectrobun(cyclic)).toBe(cyclic);
    expect(fromDrivers(cyclic)).toBe(cyclic);
  });
});
