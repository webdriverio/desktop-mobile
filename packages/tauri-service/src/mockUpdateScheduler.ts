import { type BatchCallDataTarget, createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { TauriExecuteOptions, TauriMock, TauriMockApplyData, TauriMockReadAccessor } from '@wdio/native-types';
import { createLogger, isMultiremote } from '@wdio/native-utils';
import { execute } from './commands/execute.js';
import { getMockOwnerBrowser, isWindowNotFoundError, markMockWindowClosed, runInterceptorScript } from './mock.js';
import mockStore from './mockStore.js';

const log = createLogger('tauri-service', 'service');
const browserInterceptor = createIpcInterceptor('tauri');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One scheduler per browser session — keyed weakly so GC can claim finished sessions.
const mockUpdateSchedulers = new WeakMap<WebdriverIO.Browser, MockUpdateScheduler>();

/**
 * Coalesces mock-update round-trips so N concurrent DOM interactions run <= 2 batches instead of N, each
 * reading every mock in a window in one eval. An app's lanes run one at a time on every runner platform,
 * because the app may be on Windows when the runner isn't, and its windows share one WebView2 process.
 * Separate apps, as in multiremote, run in parallel. Each lane is retried once (after 50 ms) before failing:
 * swallowing a failed read would leave mock.calls empty, which is harder to diagnose than an AggregateError.
 */
class MockUpdateScheduler {
  #browser: WebdriverIO.Browser;
  #running: Promise<void> | undefined;
  #queued: Promise<void> | undefined;

  constructor(browser: WebdriverIO.Browser) {
    this.#browser = browser;
  }

  schedule(): Promise<void> {
    if (!this.#running) {
      const p = this.#wrapRun(this.#runOnce());
      this.#running = p;
      return p;
    }
    if (!this.#queued) {
      this.#queued = this.#running.catch(() => undefined).then(() => this.#runOnce());
    }
    return this.#queued;
  }

  // Atomically promotes the queued batch into the running slot once the current
  // batch settles (resolved or rejected), preventing a third concurrent batch
  // from racing between the two.
  #wrapRun(run: Promise<void>): Promise<void> {
    let wrapped!: Promise<void>;
    wrapped = run.finally(() => {
      if (this.#running !== wrapped) {
        return;
      }
      if (this.#queued) {
        const promoted = this.#queued;
        this.#queued = undefined;
        // The queued batch's callers hold `promoted` and observe its rejection there.
        // This wrapper is held only by #running and is never awaited externally, so
        // swallow its rejection — otherwise a failing queued batch surfaces as an
        // unhandled rejection (a worker crash under Node's default throw policy).
        const nextRunning = this.#wrapRun(promoted);
        nextRunning.catch(() => undefined);
        this.#running = nextRunning;
      } else {
        this.#running = undefined;
      }
    });
    return wrapped;
  }

  async #runOnce(): Promise<void> {
    const mocks = getMocksInScope(this.#browser);
    if (mocks.length === 0) {
      return;
    }

    const lanesByApp = new Map<WebdriverIO.Browser | undefined, UpdateLane[]>();
    for (const lane of buildUpdateLanes(this.#browser, mocks)) {
      const app = lane.browser && !isMultiremote(lane.browser) ? lane.browser : undefined;
      lanesByApp.set(app, [...(lanesByApp.get(app) ?? []), lane]);
    }
    const appLanes = [...lanesByApp].filter(([app]) => app !== undefined).map(([, lanes]) => lanes);
    const errors = (await Promise.all(appLanes.map(runLanesInTurn))).flat();
    // A mock that doesn't say which app it's in, or one made on the multiremote root, whose reads reach every
    // instance's app, runs after the others, so it can't overlap them.
    errors.push(...(await runLanesInTurn(lanesByApp.get(undefined) ?? [])));
    if (errors.length > 0) {
      throw new AggregateError(
        errors.map((e) => e.error),
        `Mock updates failed for: ${errors.map((e) => e.label).join(', ')}`,
      );
    }
  }
}

interface BatchMockEntry {
  mockId: string;
  mock: TauriMock;
  accessor: TauriMockReadAccessor;
  applyCalls: (data: TauriMockApplyData) => void;
}

interface WindowBatchLane {
  kind: 'native' | 'browser';
  browser: WebdriverIO.Browser;
  windowLabel?: string;
  entries: BatchMockEntry[];
}

interface UpdateLane {
  label: string;
  /** The app the lane reads from, or undefined for a mock that doesn't say. */
  browser?: WebdriverIO.Browser;
  run: () => Promise<void>;
}

// A window's read succeeded but some of its mocks' data didn't serialize; the others were applied.
class MockSliceErrors extends Error {
  constructor(readonly failures: Array<{ mockId: string; error: Error }>) {
    super(failures.map(({ error }) => error.message).join('; '));
  }
}

async function runLanesInTurn(lanes: UpdateLane[]): Promise<Array<{ label: string; error: unknown }>> {
  const errors: Array<{ label: string; error: unknown }> = [];
  for (const lane of lanes) {
    try {
      await tryUpdateLane(lane);
    } catch (error) {
      if (error instanceof MockSliceErrors) {
        errors.push(...error.failures.map(({ mockId, error: sliceError }) => ({ label: mockId, error: sliceError })));
      } else {
        errors.push({ label: lane.label, error });
      }
    }
  }
  return errors;
}

async function tryUpdateLane(lane: UpdateLane): Promise<void> {
  try {
    await lane.run();
  } catch (firstError) {
    log.debug(`Mock update failed for ${lane.label}, retrying in 50ms:`, firstError);
    await sleep(50);
    await lane.run();
  }
}

function buildBatchTargets(entries: BatchMockEntry[]): BatchCallDataTarget[] {
  return entries.map(({ mock: m, accessor }) => {
    const calls = m.mock?.calls;
    if (!Array.isArray(calls)) {
      return { name: accessor.command };
    }
    const since = calls.length;
    const order = m.mock.invocationCallOrder;
    const lastCallOrder = since > 0 && Array.isArray(order) && order.length >= since ? order[since - 1] : undefined;
    return {
      name: accessor.command,
      since,
      ...(lastCallOrder !== undefined ? { lastCallOrder } : {}),
    };
  });
}

async function runBatchLane(lane: WindowBatchLane): Promise<void> {
  const targets = buildBatchTargets(lane.entries);
  const script = browserInterceptor.buildBatchCallDataReadScript(targets);

  let raw: unknown;
  if (lane.kind === 'browser') {
    raw = await runInterceptorScript<unknown>(lane.browser, script);
  } else {
    try {
      const executeOptions = { windowLabel: lane.windowLabel, __wdioOptions__: true } as TauriExecuteOptions;
      raw = await execute<unknown, [TauriExecuteOptions]>(lane.browser, script, executeOptions);
    } catch (error) {
      if (isWindowNotFoundError(error, lane.windowLabel)) {
        for (const { mockId, mock: m } of lane.entries) {
          markMockWindowClosed(m, lane.browser, mockId);
        }
        return;
      }
      throw error;
    }
  }

  const parsed = browserInterceptor.parseBatchCallData(raw);
  const failures: Array<{ mockId: string; error: Error }> = [];
  for (const { mockId, accessor, applyCalls } of lane.entries) {
    const slice = Object.hasOwn(parsed, accessor.command)
      ? parsed[accessor.command]
      : { calls: [], results: [], invocationCallOrder: [] };
    if (slice.__error) {
      failures.push({ mockId, error: new Error(`Batch read failed for mock "${mockId}": ${slice.__error}`) });
      continue;
    }
    applyCalls(slice);
  }
  if (failures.length > 0) {
    throw new MockSliceErrors(failures);
  }
}

function buildUpdateLanes(rootBrowser: WebdriverIO.Browser, mocks: Array<[string, TauriMock]>): UpdateLane[] {
  const groupsByBrowser = new Map<WebdriverIO.Browser, Map<string, WindowBatchLane>>();
  const lanes: UpdateLane[] = [];

  for (const [mockId, mockInstance] of mocks) {
    const accessor = mockInstance.__accessor;
    const applyCalls = mockInstance.__applyCalls;
    if (accessor && typeof applyCalls === 'function') {
      const targetBrowser = getMockOwnerBrowser(mockInstance) ?? rootBrowser;
      const windowLabel = accessor.kind === 'native' ? accessor.windowLabel : undefined;
      const groupKey =
        accessor.kind === 'browser' ? 'browser' : windowLabel === undefined ? 'native:' : `native:w:${windowLabel}`;

      let browserGroups = groupsByBrowser.get(targetBrowser);
      if (!browserGroups) {
        browserGroups = new Map();
        groupsByBrowser.set(targetBrowser, browserGroups);
      }
      let batchLane = browserGroups.get(groupKey);
      if (!batchLane) {
        batchLane = {
          kind: accessor.kind,
          browser: targetBrowser,
          windowLabel,
          entries: [],
        };
        browserGroups.set(groupKey, batchLane);
        const laneRef = batchLane;
        lanes.push({
          get label() {
            return laneRef.entries.map((entry) => entry.mockId).join(', ');
          },
          browser: targetBrowser,
          run: () => runBatchLane(laneRef),
        });
      }
      batchLane.entries.push({ mockId, mock: mockInstance, accessor, applyCalls });
    } else {
      lanes.push({
        label: mockId,
        run: async () => {
          await mockInstance.update();
        },
      });
    }
  }

  return lanes;
}

// A multiremote root's commands fan out to every instance, so it sees every instance's mocks
export function getMocksInScope(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser): [string, TauriMock][] {
  return isMultiremote(browser) ? mockStore.getAllMocks() : mockStore.getMocks(browser);
}

export function getMockUpdateScheduler(browser: WebdriverIO.Browser): MockUpdateScheduler {
  let scheduler = mockUpdateSchedulers.get(browser);
  if (!scheduler) {
    scheduler = new MockUpdateScheduler(browser);
    mockUpdateSchedulers.set(browser, scheduler);
  }
  return scheduler;
}
