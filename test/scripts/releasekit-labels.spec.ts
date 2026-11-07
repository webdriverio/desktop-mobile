import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ReleaseKit renamed `ci.labels.stable` to `ci.labels.graduate` (goosewobbler/releasekit#442) and
// its config parser silently drops unknown keys, so a stale `stable` key graduates nothing.
const CONFIG = JSON.parse(readFileSync(join(import.meta.dirname, '../../releasekit.config.json'), 'utf8'));

describe('releasekit.config.json ci.labels', () => {
  it('should use the graduate key that ReleaseKit reads for the stable label', () => {
    expect(CONFIG.ci.labels.graduate).toBe('release:stable');
  });

  it('should not keep the renamed stable key that ReleaseKit ignores', () => {
    expect(CONFIG.ci.labels).not.toHaveProperty('stable');
  });
});
