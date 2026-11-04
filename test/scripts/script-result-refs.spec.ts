// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/platform/script-result-refs.js';
const DIOXUS_COPY = 'packages/dioxus-embedded-driver/src/server/handlers/script-result-refs.js';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

type ScriptResultRefs = {
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

function byId(id: string) {
  return document.getElementById(id) as HTMLElement;
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

    it.each([
      ['an array', () => [byId('first')]],
      ['an element', () => byId('first')],
      ['a plain object keyed by index', () => ({ 0: byId('first'), length: 1 })],
    ])('should return undefined for %s', (_name, value) => {
      expect(refs.listOf(value())).toBeUndefined();
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

    it('should return a result JSON.stringify rejects as it is', () => {
      const cyclic: Record<string, unknown> = { el: byId('first') };
      cyclic.self = cyclic;

      expect(refs.withRefs(cyclic)).toBe(cyclic);
    });
  });
});
