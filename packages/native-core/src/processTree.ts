import { type ChildProcess, spawn } from 'node:child_process';

// Kept out of index.ts: internal to the package's process handling, not package API

// Windows has no process groups, so killing a parent such as cmd.exe leaves the processes it started running;
// taskkill /T walks the tree instead. If taskkill can't run, the parent is killed directly. A failed taskkill
// leaves the parent running, so a caller's force-kill step can still walk its tree.
export function killWindowsProcessTree(proc: ChildProcess): void {
  if (proc.pid === undefined) {
    proc.kill();
    return;
  }
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => proc.kill());
}
