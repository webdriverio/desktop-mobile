import { describe, expect, it } from 'vitest';

import { classifyTarget } from '../src/cefClassifier.js';

describe('classifyTarget (CEF)', () => {
  it('should classify a views:// page as content', () => {
    expect(classifyTarget({ type: 'page', url: 'views://mainview/index.html' })).toBe('content');
  });

  it('should classify an http(s) dev-server page as content', () => {
    expect(classifyTarget({ type: 'page', url: 'http://localhost:5173/' })).toBe('content');
  });

  it('should classify about:blank as a shell target', () => {
    expect(classifyTarget({ type: 'page', url: 'about:blank' })).toBe('shell');
  });

  it('should classify devtools/chrome pages as other', () => {
    expect(classifyTarget({ type: 'page', url: 'devtools://devtools/bundled/inspector.html' })).toBe('other');
    expect(classifyTarget({ type: 'page', url: 'chrome://gpu' })).toBe('other');
  });

  it('should classify non-page targets as other', () => {
    expect(classifyTarget({ type: 'service_worker', url: 'views://mainview/sw.js' })).toBe('other');
  });

  it('should fail open to content for an unknown page scheme', () => {
    expect(classifyTarget({ type: 'page', url: 'app://weird/path' })).toBe('content');
  });
});
