import type { ElectronMock, ExecuteOpts } from '@wdio/native-types';
import type { ElectronServiceContext } from './forEachMock.js';
import { getMockBrowser, mock } from './mock.js';

export async function mockAll(this: ElectronServiceContext | undefined, apiName: string) {
  const browserContext = getMockBrowser(this);
  if (!browserContext) {
    throw new Error('mockAll requires a valid browser context');
  }
  const apiFnNames = (
    await browserContext.electron.execute<string, [string, ExecuteOpts]>(
      (electron, apiName) => Object.keys(electron[apiName as keyof typeof electron]).toString(),
      apiName,
      { internal: true },
    )
  ).split(',');
  const mockedApis: Record<string, ElectronMock> = {};

  apiFnNames.forEach((funcName) => {
    mockedApis[funcName] = (() => undefined) as unknown as ElectronMock;
  });

  for (const funcName in mockedApis) {
    mockedApis[funcName] = (await mock.call({ browser: browserContext }, apiName, funcName)) as ElectronMock;
  }

  return mockedApis;
}
