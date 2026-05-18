// Port allocation for driver subprocesses.
//
// Extracted unchanged from packages/tauri-service/src/portManager.ts (the
// only modification is the `createLogger` argument). The "port pair"
// abstraction (main driver port + native driver port) maps directly onto
// both Tauri's (tauri-driver + msedgedriver/WebKitWebDriver) and Dioxus's
// (wdio-dioxus-driver + msedgedriver) external-provider layout.
//
// Services that use a single port (e.g., the embedded provider) call
// `allocatePort` instead of `allocatePortPair`.

import { createLogger } from '@wdio/native-utils';
import getPort from 'get-port';

const log = createLogger('native-core', 'launcher');

export interface PortPair {
  port: number;
  nativePort: number;
}

export class PortManager {
  private usedPorts = new Set<number>();
  private basePort: number;
  private baseNativePort: number;

  constructor(basePort = 4444, baseNativePort = 4445) {
    this.basePort = basePort;
    this.baseNativePort = baseNativePort;
  }

  async allocatePort(preferredPort?: number): Promise<number> {
    const port = await getPort({
      port: preferredPort ?? this.basePort,
      host: '127.0.0.1',
      exclude: Array.from(this.usedPorts),
    });
    this.usedPorts.add(port);
    log.debug(`Allocated port: ${port}`);
    return port;
  }

  async allocatePortPair(preferredPort?: number, preferredNativePort?: number): Promise<PortPair> {
    const port = await getPort({
      port: preferredPort ?? this.basePort,
      host: '127.0.0.1',
      exclude: Array.from(this.usedPorts),
    });
    this.usedPorts.add(port);

    let nativePort: number;
    try {
      nativePort = await getPort({
        port: preferredNativePort ?? this.baseNativePort,
        host: '127.0.0.1',
        exclude: Array.from(this.usedPorts),
      });
    } catch (error) {
      this.usedPorts.delete(port);
      throw error;
    }
    this.usedPorts.add(nativePort);

    log.debug(`Allocated port pair: main=${port}, native=${nativePort}`);
    return { port, nativePort };
  }

  async allocatePorts(count: number): Promise<PortPair[]> {
    const pairs: PortPair[] = [];

    for (let i = 0; i < count; i++) {
      const preferredPort = this.basePort + i;
      const preferredNativePort = this.baseNativePort + i;
      const pair = await this.allocatePortPair(preferredPort, preferredNativePort);
      pairs.push(pair);
    }

    log.info(`Allocated ${count} port pairs`);
    return pairs;
  }

  releasePort(port: number): void {
    this.usedPorts.delete(port);
    log.debug(`Released port: ${port}`);
  }

  releasePorts(ports: number[]): void {
    for (const port of ports) {
      this.usedPorts.delete(port);
    }
    log.debug(`Released ${ports.length} ports`);
  }

  getUsedPorts(): number[] {
    return Array.from(this.usedPorts);
  }

  clear(): void {
    this.usedPorts.clear();
    log.debug('Cleared all used ports');
  }
}
