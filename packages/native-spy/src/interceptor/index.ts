import { DioxusAdapter } from './dioxus.js';
import { ElectronAdapter } from './electron.js';
import type { Framework, FrameworkAdapter, InnerMockMethod, InnerMockSetterMethod } from './framework.js';
import type { IpcContext } from './ipcContext.js';
import type { SerializedHandler } from './serialize.js';
import { serializeHandler } from './serialize.js';
import type { BatchCallDataSlice, BatchCallDataTarget, MockCallData } from './syncProtocol.js';
import { parseBatchCallData, parseCallData } from './syncProtocol.js';
import { TauriAdapter } from './tauri.js';

export type { Framework, InnerMockMethod, InnerMockSetterMethod } from './framework.js';
export type { IpcContext } from './ipcContext.js';
export type { SerializedHandler } from './serialize.js';
export type { BatchCallDataSlice, BatchCallDataTarget, MockCallData } from './syncProtocol.js';
export { parseBatchCallData, parseCallData };

export interface InterceptorOptions {
  context?: IpcContext;
}

export interface IpcInterceptor {
  readonly framework: Framework;
  serializeHandler(fn: (...a: unknown[]) => unknown): SerializedHandler;
  buildRegistrationScript(mockName: string): string;
  buildSetImplementationScript(mockName: string, s: SerializedHandler, once?: boolean): string;
  buildInnerInvocationScript(mockName: string, method: InnerMockMethod): string;
  buildInnerSetterScript(mockName: string, method: InnerMockSetterMethod, value: unknown): string;
  buildCallDataReadScript(mockName: string): string;
  buildBatchCallDataReadScript(mocks: readonly (string | BatchCallDataTarget)[]): string;
  buildUnregistrationScript(mockName: string): string;
  buildWithImplementationScript(
    mockName: string,
    implFn: (...a: unknown[]) => unknown,
    callbackFn: (...a: unknown[]) => unknown,
  ): string;
  parseCallData(raw: unknown): MockCallData;
  parseBatchCallData(raw: unknown): Record<string, BatchCallDataSlice>;
  buildContextSeedScript(context: IpcContext): string;
  buildBrowserIpcInjectionScript(): string;
  setContext(partial: IpcContext): IpcContext;
  getContext(): IpcContext;
}

class IpcInterceptorImpl implements IpcInterceptor {
  private _context: IpcContext;
  private adapter: FrameworkAdapter;

  constructor(adapter: FrameworkAdapter, options: InterceptorOptions = {}) {
    this.adapter = adapter;
    this._context = options.context ?? {};
  }

  get framework(): Framework {
    return this.adapter.framework;
  }

  serializeHandler(fn: (...a: unknown[]) => unknown): SerializedHandler {
    return serializeHandler(fn);
  }

  buildRegistrationScript(mockName: string): string {
    return this.adapter.buildRegistrationScript(mockName);
  }

  buildSetImplementationScript(mockName: string, s: SerializedHandler, once?: boolean): string {
    return this.adapter.buildSetImplementationScript(mockName, s, once);
  }

  buildInnerInvocationScript(mockName: string, method: InnerMockMethod): string {
    return this.adapter.buildInnerInvocationScript(mockName, method);
  }

  buildInnerSetterScript(mockName: string, method: InnerMockSetterMethod, value: unknown): string {
    return this.adapter.buildInnerSetterScript(mockName, method, value);
  }

  buildCallDataReadScript(mockName: string): string {
    return this.adapter.buildCallDataReadScript(mockName);
  }

  buildBatchCallDataReadScript(mocks: readonly (string | BatchCallDataTarget)[]): string {
    return this.adapter.buildBatchCallDataReadScript(mocks);
  }

  buildUnregistrationScript(mockName: string): string {
    return this.adapter.buildUnregistrationScript(mockName);
  }

  buildWithImplementationScript(
    mockName: string,
    implFn: (...a: unknown[]) => unknown,
    callbackFn: (...a: unknown[]) => unknown,
  ): string {
    return this.adapter.buildWithImplementationScript(mockName, implFn.toString(), callbackFn.toString());
  }

  parseCallData(raw: unknown): MockCallData {
    return parseCallData(raw);
  }

  parseBatchCallData(raw: unknown): Record<string, BatchCallDataSlice> {
    return parseBatchCallData(raw);
  }

  buildContextSeedScript(context: IpcContext): string {
    return this.adapter.buildContextSeedScript(context);
  }

  buildBrowserIpcInjectionScript(): string {
    return this.adapter.buildBrowserIpcInjectionScript();
  }

  setContext(partial: IpcContext): IpcContext {
    this._context = { ...this._context, ...partial };
    return this._context;
  }

  getContext(): IpcContext {
    return this._context;
  }
}

export function createIpcInterceptor(framework: Framework, options?: InterceptorOptions): IpcInterceptor {
  let adapter: FrameworkAdapter = new ElectronAdapter();
  if (framework === 'tauri') {
    adapter = new TauriAdapter();
  } else if (framework === 'dioxus') {
    adapter = new DioxusAdapter();
  }
  return new IpcInterceptorImpl(adapter, options);
}
