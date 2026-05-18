import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to a mock driver executable, choosing the correct extension for the platform
 * On Windows, use .cmd files; on Unix, use .sh files
 */
export function getMockDriverPath(name: 'mock-success' | 'mock-bind-fail' | 'mock-marker-only'): string {
  const fixturesDir = path.join(__dirname, 'fixtures');

  if (process.platform === 'win32') {
    return path.join(fixturesDir, `${name}.cmd`);
  }

  return path.join(fixturesDir, `${name}.sh`);
}

export const mockSuccessPath = getMockDriverPath('mock-success');
export const mockBindFailPath = getMockDriverPath('mock-bind-fail');
export const mockMarkerOnlyPath = getMockDriverPath('mock-marker-only');
