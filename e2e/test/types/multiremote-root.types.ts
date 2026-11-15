// Type-only: the E2E typecheck covers it, and no WDIO config runs it.
import '@wdio/native-types';
import type { TauriExecuteOptions } from '@wdio/native-types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectTrue = <_T extends true>(): void => undefined;

type Root = WebdriverIO.MultiRemoteBrowser;
type Instance = WebdriverIO.Browser;

// The root runs execute in every instance and resolves with one result per instance
export async function rootExecuteResolvesPerInstance(root: Root, options: TauriExecuteOptions): Promise<void> {
  const tauri = await root.tauri.execute(() => 1);
  expectTrue<Equal<typeof tauri, number[]>>();
  const tauriWithOptions = await root.tauri.execute(() => 1, options);
  expectTrue<Equal<typeof tauriWithOptions, number[]>>();
  const dioxus = await root.dioxus.execute(() => 1);
  expectTrue<Equal<typeof dioxus, number[]>>();
  const electron = await root.electron.execute(() => 1);
  expectTrue<Equal<typeof electron, number[]>>();
  const electrobun = await root.electrobun.execute(() => 1);
  expectTrue<Equal<typeof electrobun, number[]>>();
}

export async function instanceExecuteResolvesOnce(instance: Instance, options: TauriExecuteOptions): Promise<void> {
  const tauri = await instance.tauri.execute(() => 1);
  expectTrue<Equal<typeof tauri, number>>();
  const tauriWithOptions = await instance.tauri.execute(() => 1, options);
  expectTrue<Equal<typeof tauriWithOptions, number>>();
  const dioxus = await instance.dioxus.execute(() => 1);
  expectTrue<Equal<typeof dioxus, number>>();
  const electron = await instance.electron.execute(() => 1);
  expectTrue<Equal<typeof electron, number>>();
  const electrobun = await instance.electrobun.execute(() => 1);
  expectTrue<Equal<typeof electrobun, number>>();
}

// The root lists every instance's windows, one list per instance
expectTrue<Equal<Awaited<ReturnType<Root['tauri']['listWindows']>>, string[][]>>();
expectTrue<Equal<Awaited<ReturnType<Root['dioxus']['listWindows']>>, string[][]>>();
expectTrue<Equal<Awaited<ReturnType<Root['electrobun']['listWindows']>>, string[][]>>();
expectTrue<Equal<Awaited<ReturnType<Instance['tauri']['listWindows']>>, string[]>>();
expectTrue<Equal<Awaited<ReturnType<Instance['dioxus']['listWindows']>>, string[]>>();
expectTrue<Equal<Awaited<ReturnType<Instance['electrobun']['listWindows']>>, string[]>>();

type PerInstanceMethods = 'execute' | 'listWindows';

// Every other method has the same type on the root as on an instance
expectTrue<Equal<Omit<Root['tauri'], PerInstanceMethods>, Omit<Instance['tauri'], PerInstanceMethods>>>();
expectTrue<Equal<Omit<Root['dioxus'], PerInstanceMethods>, Omit<Instance['dioxus'], PerInstanceMethods>>>();
expectTrue<Equal<Omit<Root['electron'], 'execute'>, Omit<Instance['electron'], 'execute'>>>();
expectTrue<Equal<Omit<Root['electrobun'], PerInstanceMethods>, Omit<Instance['electrobun'], PerInstanceMethods>>>();
