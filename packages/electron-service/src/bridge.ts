import os from 'node:os';
import { CdpBridge, type CdpBridgeOptions, REQUEST_TIMEOUT } from '@wdio/native-cdp-bridge';
import { createLogger } from '@wdio/native-utils';

import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

const log = createLogger('electron-service', 'bridge');

type Methods = keyof ProtocolMapping.Commands;
type Events = keyof ProtocolMapping.Events;
type MethodParams<T extends Methods> = ProtocolMapping.Commands[T]['paramsType'];
type MethodReturn<T extends Methods> = ProtocolMapping.Commands[T]['returnType'];
type SendParams<T extends Methods> = MethodParams<T> extends [] ? [] : [MethodParams<T>[number]];

export const getDebuggerEndpoint = (capabilities: WebdriverIO.Capabilities) => {
  log.trace('Try to detect the node debugger endpoint');

  const debugArg = capabilities['goog:chromeOptions']?.args?.find((item) => item.startsWith('--inspect='));
  log.trace(`Detected debugger args: ${debugArg}`);

  const debugUrl = debugArg ? debugArg.split('=')[1] : undefined;
  const [host, strPort] = debugUrl ? debugUrl.split(':') : [];
  const result = { host, port: Number(strPort) };

  if (!result.host || !result.port) {
    throw new Error(
      'Failed to detect the debugger endpoint. Ensure the Electron app was launched with --inspect and a valid port.',
    );
  }

  log.trace(`Detected the node debugger endpoint: `, result);
  return result;
};

/**
 * Electron-domain wrapper over the shared single-target {@link CdpBridge}. Composes the transport
 * (rather than extending it) so it depends only on the bridge's public API — the bridge keeps its
 * options private. On top of the raw connect it runs the Electron setup: enable the Runtime domain,
 * resolve the main-world execution context, and inject the bootstrap script.
 */
export class ElectronCdpBridge {
  #bridge: CdpBridge;
  #options: CdpBridgeOptions;
  // Mirrors the bridge's effective request timeout (same `?? REQUEST_TIMEOUT` default), reused as
  // the deadline for resolving the execution context — the bridge no longer exposes its options.
  #timeout: number;
  #contextId: number = 0;

  constructor(options?: CdpBridgeOptions) {
    this.#bridge = new CdpBridge(options);
    this.#options = options ?? {};
    this.#timeout = options?.timeout ?? REQUEST_TIMEOUT;
  }

  get contextId() {
    return this.#contextId;
  }

  send<T extends Methods>(method: T, ...params: SendParams<T>): Promise<MethodReturn<T>> {
    return this.#bridge.send(method, ...params);
  }

  on<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    this.#bridge.on(event, listener);
    return this;
  }

  off<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    this.#bridge.off(event, listener);
    return this;
  }

  async connect(): Promise<void> {
    const startTime = Date.now();
    log.debug('CdpBridge options:', this.#options);

    await this.#bridge.connect();
    log.debug(`[+${Date.now() - startTime}ms] CDP connection established, setting up context handler`);

    const t2 = Date.now();
    const contextHandler = this.#getContextIdHandler();
    log.debug(`[+${Date.now() - startTime}ms] Context handler promise created (took ${Date.now() - t2}ms)`);

    const t3 = Date.now();
    log.debug(`[+${Date.now() - startTime}ms] Sending Runtime.enable`);
    try {
      await this.send('Runtime.enable');
      log.debug(`[+${Date.now() - startTime}ms] Runtime.enable completed (took ${Date.now() - t3}ms)`);
    } catch (error) {
      log.error(`[+${Date.now() - startTime}ms] Runtime.enable failed after ${Date.now() - t3}ms:`, error);
      throw error;
    }

    const t5 = Date.now();
    log.debug(`[+${Date.now() - startTime}ms] Sending Runtime.disable`);
    try {
      await this.send('Runtime.disable');
      log.debug(`[+${Date.now() - startTime}ms] Runtime.disable completed (took ${Date.now() - t5}ms)`);
    } catch (error) {
      log.error(`[+${Date.now() - startTime}ms] Runtime.disable failed after ${Date.now() - t5}ms:`, error);
      throw error;
    }

    const t4 = Date.now();
    log.debug(`[+${Date.now() - startTime}ms] Waiting for context ID`);
    this.#contextId = await contextHandler;
    log.debug(`[+${Date.now() - startTime}ms] Context ID received: ${this.#contextId} (waited ${Date.now() - t4}ms)`);

    const t6 = Date.now();
    await this.send('Runtime.evaluate', {
      expression: getInitializeScript(),
      includeCommandLineAPI: true,
      replMode: true,
      contextId: this.#contextId,
    });
    log.debug(`[+${Date.now() - startTime}ms] Initialization script executed (took ${Date.now() - t6}ms)`);
  }

  #getContextIdHandler() {
    return new Promise<number>((resolve, reject) => {
      const handlerStartTime = Date.now();
      log.debug(`[Handler +0ms] Setting up Runtime.executionContextCreated listener (timeout: ${this.#timeout}ms)`);
      let eventCount = 0;
      let firstContextId: number | null = null;
      let resolved = false;

      const onContextCreated = (params: {
        context: { id: number; name: string; origin: string; auxData?: { isDefault?: boolean } };
      }) => {
        if (resolved) {
          return;
        }

        eventCount++;
        const eventTime = Date.now() - handlerStartTime;
        log.debug(`[Handler +${eventTime}ms] Runtime.executionContextCreated event #${eventCount} received:`, {
          contextId: params.context.id,
          name: params.context.name,
          origin: params.context.origin,
          isDefault: params.context.auxData?.isDefault,
          auxData: params.context.auxData,
        });

        if (firstContextId === null) {
          firstContextId = params.context.id;
          log.debug(`[Handler +${eventTime}ms] Stored first context ID as fallback: ${firstContextId}`);
        }

        if (params.context.auxData?.isDefault) {
          log.debug(
            `[Handler +${eventTime}ms] Found default context with ID: ${params.context.id}, resolving immediately`,
          );
          resolved = true;
          clearTimeout(timeoutId);
          this.off('Runtime.executionContextCreated', onContextCreated);
          resolve(params.context.id);
        } else {
          log.debug(`[Handler +${eventTime}ms] Context is not marked as default, waiting for next event`);
        }
      };

      this.on('Runtime.executionContextCreated', onContextCreated);

      log.debug(
        `[Handler +${Date.now() - handlerStartTime}ms] Listener registered, setting ${this.#timeout}ms timeout`,
      );

      const timeoutId = setTimeout(() => {
        if (resolved) {
          log.debug(`[Handler +${Date.now() - handlerStartTime}ms] Timeout fired but already resolved, skipping`);
          return;
        }

        const timeoutTime = Date.now() - handlerStartTime;
        log.debug(
          `[Handler +${timeoutTime}ms] Timeout fired, resolved=${resolved}, eventCount=${eventCount}, firstContextId=${firstContextId}`,
        );
        resolved = true;
        this.off('Runtime.executionContextCreated', onContextCreated);

        if (firstContextId !== null) {
          log.warn(
            `[Handler +${timeoutTime}ms] No default context found after ${this.#timeout}ms, using first context ID: ${firstContextId} (received ${eventCount} context events)`,
          );
          resolve(firstContextId);
        } else {
          const err = new Error(
            `Timeout exceeded to get the ContextId after ${this.#timeout}ms (received ${eventCount} context events)`,
          );
          log.error(`[Handler +${timeoutTime}ms] ${err.message}`);
          reject(err);
        }
      }, this.#timeout);
    });
  }
}

function getInitializeScript() {
  const scripts = [
    // Add __name to the global object to work around issue with function serialization
    // This enables browser.execute to work with scripts which declare functions (affects TS specs only)
    // https://github.com/webdriverio-community/wdio-electron-service/issues/756
    // https://github.com/privatenumber/tsx/issues/113
    `globalThis.__name = globalThis.__name ?? ((func) => func);`,
    // Add electron to the global object
    `globalThis.electron = require('electron');`,
  ];

  // add because windows is not exposed the process object to global scope
  if (os.type().match('Windows')) {
    scripts.push(`globalThis.process = require('node:process');`);
  }
  return scripts.join('\n');
}
