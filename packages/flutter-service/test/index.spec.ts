import { describe, expect, it } from 'vitest';

import FlutterService, {
  cleanupWdioSession,
  createFlutterCapabilities,
  launcher,
  startWdioSession,
} from '../src/index.js';

describe('@wdio/flutter-service exports', () => {
  it('should export the worker service as the default', () => {
    expect(typeof FlutterService).toBe('function');
  });

  it('should export the launcher', () => {
    expect(typeof launcher).toBe('function');
  });

  it('should export the standalone session helpers', () => {
    expect(typeof startWdioSession).toBe('function');
    expect(typeof cleanupWdioSession).toBe('function');
    expect(typeof createFlutterCapabilities).toBe('function');
  });

  it('createFlutterCapabilities should build a capability with the service options', () => {
    const c = createFlutterCapabilities('Android', { vmServicePort: 8181 });
    expect(c.platformName).toBe('Android');
    expect(c['wdio:flutterServiceOptions']).toEqual({ vmServicePort: 8181 });
  });
});
