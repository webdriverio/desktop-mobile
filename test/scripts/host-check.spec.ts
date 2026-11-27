import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TAURI_COPY = 'packages/tauri-plugin-webdriver/src/server/host_check.rs';
const DIOXUS_COPY = 'packages/dioxus-embedded-driver/src/server/host_check.rs';

describe('host_check.rs', () => {
  it('should be the same in both embedded driver crates', () => {
    expect(readFileSync(join(REPO_ROOT, DIOXUS_COPY), 'utf8'), `copy ${TAURI_COPY} over ${DIOXUS_COPY}`).toBe(
      readFileSync(join(REPO_ROOT, TAURI_COPY), 'utf8'),
    );
  });
});
