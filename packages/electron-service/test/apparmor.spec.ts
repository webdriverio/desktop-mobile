import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock creation before all imports
const { mockExecSync, mockSpawnSync, mockFs } = vi.hoisted(() => {
  return {
    mockExecSync: vi.fn(),
    mockSpawnSync: vi.fn(),
    mockFs: {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
  };
});

vi.mock('node:child_process', () => ({
  default: {
    execSync: mockExecSync,
    spawnSync: mockSpawnSync,
  },
  execSync: mockExecSync,
  spawnSync: mockSpawnSync,
}));

vi.mock('node:fs', () => ({
  default: mockFs,
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { applyApparmorWorkaround } from '../src/apparmor.js';

describe('apparmor', () => {
  let originalGetuid: typeof process.getuid;

  beforeEach(() => {
    originalGetuid = process.getuid;
    vi.clearAllMocks();
  });

  afterEach(() => {
    restorePlatform();
    Object.defineProperty(process, 'getuid', {
      value: originalGetuid,
      writable: true,
    });
  });

  function mockGetuid(uid: number | undefined) {
    Object.defineProperty(process, 'getuid', {
      value: uid === undefined ? undefined : () => uid,
      writable: true,
    });
  }

  describe('applyApparmorWorkaround', () => {
    it('should skip on non-Linux platforms', () => {
      mockPlatform('darwin');

      applyApparmorWorkaround(['/path/to/electron'], true);

      expect(mockSpawnSync).not.toHaveBeenCalled();
      expect(mockFs.existsSync).not.toHaveBeenCalled();
    });

    it('should skip when installMode is false', () => {
      mockPlatform('linux');

      applyApparmorWorkaround(['/path/to/electron'], false);

      expect(mockSpawnSync).not.toHaveBeenCalled();
      expect(mockFs.existsSync).not.toHaveBeenCalled();
    });

    it('should check AppArmor status when on Linux and installMode is enabled', () => {
      mockPlatform('linux');
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockFs.existsSync.mockReturnValue(false);

      applyApparmorWorkaround(['/path/to/electron'], true);

      expect(mockSpawnSync).toHaveBeenCalledWith('aa-status', { encoding: 'utf8' });
    });

    describe('AppArmor detection', () => {
      beforeEach(() => {
        mockPlatform('linux');
      });

      it('should detect AppArmor running via aa-status success', () => {
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('1');
        mockGetuid(1000);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockSpawnSync).toHaveBeenCalledWith('aa-status', { encoding: 'utf8' });
        expect(mockFs.readFileSync).toHaveBeenCalledWith(
          '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
          'utf8',
        );
      });

      it('should detect AppArmor running via aa-status exit code 4 (insufficient privileges)', () => {
        mockSpawnSync.mockReturnValue({ status: 4 });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('1');
        mockGetuid(1000);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockSpawnSync).toHaveBeenCalledWith('aa-status', { encoding: 'utf8' });
        expect(mockFs.readFileSync).toHaveBeenCalledWith(
          '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
          'utf8',
        );
      });

      it('should fallback to filesystem check when aa-status fails', () => {
        mockSpawnSync.mockReturnValue({ status: 1 });
        mockFs.existsSync.mockReturnValueOnce(true); // AppArmor profiles path
        mockFs.existsSync.mockReturnValueOnce(true); // restriction path
        mockFs.readFileSync.mockReturnValueOnce('some profiles'); // profiles content
        mockFs.readFileSync.mockReturnValueOnce('1'); // restriction value
        mockGetuid(1000);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.existsSync).toHaveBeenCalledWith('/sys/kernel/security/apparmor/profiles');
        expect(mockFs.readFileSync).toHaveBeenCalledWith('/sys/kernel/security/apparmor/profiles', 'utf8');
      });

      it('should skip workaround when AppArmor is not running', () => {
        mockSpawnSync.mockReturnValue({ status: 1 });
        mockFs.existsSync.mockReturnValue(false);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should skip workaround when restriction is disabled', () => {
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('0'); // restriction disabled

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should apply workaround when restriction file does not exist but AppArmor is active', () => {
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockFs.existsSync.mockReturnValueOnce(false); // restriction file doesn't exist
        mockGetuid(0); // running as root

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).toHaveBeenCalled();
        expect(mockExecSync).toHaveBeenCalled();
      });
    });

    describe('Profile creation', () => {
      beforeEach(() => {
        mockPlatform('linux');
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('1'); // restriction enabled
      });

      it('should create profile when running as root', () => {
        mockGetuid(0);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
          '/etc/apparmor.d/electron-wdio-service',
          expect.stringContaining('profile electron-electron-wdio-service "/path/to/electron" flags=(unconfined)'),
        );

        const profileContent = mockFs.writeFileSync.mock.calls[0][1] as string;
        expect(profileContent).toContain('userns,');
        expect(mockExecSync).toHaveBeenCalledWith('apparmor_parser -r /etc/apparmor.d/electron-wdio-service', {
          encoding: 'utf8',
        });
      });

      it('should create profile using sudo when not root but sudo available', () => {
        mockGetuid(1000);
        mockSpawnSync.mockImplementation(function (command, args) {
          if (command === 'sudo' && args?.[0] === '-n') {
            return { status: 0 }; // sudo available
          }
          return { status: 0 };
        });

        applyApparmorWorkaround(['/path/to/electron'], 'sudo');

        expect(mockExecSync).toHaveBeenCalledWith(
          'sudo tee /etc/apparmor.d/electron-wdio-service > /dev/null',
          expect.objectContaining({
            input: expect.stringContaining(
              'profile electron-electron-wdio-service "/path/to/electron" flags=(unconfined)',
            ),
          }),
        );

        const profileContent = mockExecSync.mock.calls[0][1].input as string;
        expect(profileContent).toContain('userns,');
        expect(mockExecSync).toHaveBeenCalledWith('sudo apparmor_parser -r /etc/apparmor.d/electron-wdio-service', {
          encoding: 'utf8',
        });
      });

      it('should skip profile creation when not root and installMode is true', () => {
        mockGetuid(1000);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should skip profile creation when sudo not available and installMode is sudo', () => {
        mockGetuid(1000);
        mockSpawnSync.mockImplementation(function (command, args) {
          if (command === 'sudo' && args?.[0] === '-n') {
            return { status: 1 }; // sudo not available
          }
          return { status: 0 };
        });

        applyApparmorWorkaround(['/path/to/electron'], 'sudo');

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should handle multiple electron binary paths', () => {
        mockGetuid(0);

        const binaryPaths = ['/path/to/electron1', '/path/to/electron2'];
        applyApparmorWorkaround(binaryPaths, true);

        const profileContent = mockFs.writeFileSync.mock.calls[0][1] as string;
        expect(profileContent).toContain(
          'profile electron1-electron-wdio-service "/path/to/electron1" flags=(unconfined)',
        );
        expect(profileContent).toContain(
          'profile electron2-electron-wdio-service "/path/to/electron2" flags=(unconfined)',
        );
        expect(profileContent).toContain('userns,');
      });

      it('should handle profile creation failure gracefully', () => {
        mockGetuid(0);
        mockFs.writeFileSync.mockImplementation(function () {
          throw new Error('Permission denied');
        });

        applyApparmorWorkaround(['/path/to/electron'], true);

        // Should not throw and should continue with fallback warning
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });
    });

    describe('isRoot function behavior', () => {
      beforeEach(() => {
        mockPlatform('linux');
        mockSpawnSync.mockReturnValue({ status: 0 });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('1');
      });

      it('should handle getuid returning 0 (root)', () => {
        mockGetuid(0);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });

      it('should handle getuid returning non-zero (non-root)', () => {
        mockGetuid(1000);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      });

      it('should handle getuid being undefined (e.g., Windows)', () => {
        mockGetuid(undefined);

        applyApparmorWorkaround(['/path/to/electron'], true);

        expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      });
    });

    describe('canUseSudo function behavior', () => {
      beforeEach(() => {
        mockPlatform('linux');
        mockSpawnSync.mockImplementation(function (command) {
          if (command === 'aa-status') {
            return { status: 0 };
          }
          return { status: 0 };
        });
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('1');
        mockGetuid(1000);
      });

      it('should detect available sudo', () => {
        mockSpawnSync.mockImplementation(function (command, args) {
          if (command === 'aa-status') {
            return { status: 0 };
          }
          if (command === 'sudo' && args?.[0] === '-n') {
            return { status: 0 }; // sudo available
          }
          return { status: 0 };
        });

        applyApparmorWorkaround(['/path/to/electron'], 'sudo');

        expect(mockSpawnSync).toHaveBeenCalledWith('sudo', ['-n', 'true'], { encoding: 'utf8' });
        expect(mockExecSync).toHaveBeenCalled(); // Should proceed with profile creation
      });

      it('should handle sudo command throwing error', () => {
        mockSpawnSync.mockImplementation(function (command, args) {
          if (command === 'aa-status') {
            return { status: 0 };
          }
          if (command === 'sudo' && args?.[0] === '-n') {
            throw new Error('sudo command not found');
          }
          return { status: 0 };
        });

        applyApparmorWorkaround(['/path/to/electron'], 'sudo');

        expect(mockExecSync).not.toHaveBeenCalled(); // Should not proceed
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockPlatform('linux');
      });

      it('should apply workaround when AppArmor detection throws error', () => {
        mockSpawnSync.mockImplementation(function () {
          throw new Error('Command failed');
        });
        mockFs.existsSync.mockImplementation(function () {
          throw new Error('File access failed');
        });
        mockGetuid(0);

        applyApparmorWorkaround(['/path/to/electron'], true);

        // Should proceed with workaround due to uncertainty
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });

      it('should handle filesystem read errors during AppArmor profile check', () => {
        mockSpawnSync.mockReturnValue({ status: 1 }); // aa-status fails
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation(function (path) {
          if (path === '/sys/kernel/security/apparmor/profiles') {
            throw new Error('Permission denied');
          }
          return '1';
        });
        mockGetuid(0);

        applyApparmorWorkaround(['/path/to/electron'], true);

        // Should assume AppArmor is running and proceed
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });
    });
  });
});
