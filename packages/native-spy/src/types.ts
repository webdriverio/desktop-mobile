/**
 * Mock result types for tracking call outcomes
 */
export type MockResultType = 'return' | 'throw' | 'innate';

export interface MockResult<T = unknown> {
  type: MockResultType;
  value: T;
}

/**
 * Context for tracking mock calls
 */
export interface MockContext {
  callId: number;
  this: unknown;
  arguments: unknown[];
}

/**
 * Mock metadata (non-circular, safe for serialization)
 * Matches vitest's MockContext structure
 */
export interface MockMetadata<T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown> {
  calls: Parameters<T>[]; // Array of argument arrays (like vitest)
  contexts: unknown[]; // Array of `this` values
  results: MockResult[];
  invocationCallOrder: number[];
  instances: unknown[];
  lastCall?: Parameters<T>; // Last call arguments (computed, not stored)
}

/**
 * The Mock interface exposed to users
 */
export interface Mock<T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown> {
  /**
   * Mock function implementation
   */
  (...args: Parameters<T>): ReturnType<T>;

  /**
   * Marker property to identify mock functions (vitest compatibility)
   */
  _isMockFunction: boolean;

  /**
   * Mock state - array of call arguments (like vitest spy)
   */
  readonly calls: Parameters<T>[];

  /**
   * Mock state - results of each call
   */
  readonly results: Array<MockResult<ReturnType<T>>>;

  /**
   * Mock state - order of invocations
   */
  readonly invocationCallOrder: number[];

  /**
   * Instances created by the mock (when constructor is mocked)
   */
  readonly instances: T[];

  /**
   * Mock metadata - non-circular reference for tracking
   */
  readonly mock: MockMetadata<T>;

  /**
   * Set the mock name
   */
  mockName(name: string): this;

  /**
   * Get the mock name
   */
  getMockName(): string;

  /**
   * Clear all call data
   */
  mockClear(): this;

  /**
   * Reset all state including return values
   */
  mockReset(): this;

  /**
   * Restore original implementation
   */
  mockRestore(): this;

  /**
   * Set implementation
   */
  mockImplementation(fn: T): this;

  /**
   * Set implementation for next call only
   */
  mockImplementationOnce(fn: T): this;

  /**
   * Get the current mock implementation
   */
  getMockImplementation(): T | undefined;

  /**
   * Return a specific value
   */
  mockReturnValue(value: ReturnType<T>): this;

  /**
   * Return a specific value for next call only
   */
  mockReturnValueOnce(value: ReturnType<T>): this;

  /**
   * Resolve with a specific value
   */
  mockResolvedValue(value: Awaited<ReturnType<T>>): this;

  /**
   * Resolve with a specific value for next call only
   */
  mockResolvedValueOnce(value: Awaited<ReturnType<T>>): this;

  /**
   * Reject with an error
   */
  mockRejectedValue(reason: unknown): this;

  /**
   * Reject with an error for next call only
   */
  mockRejectedValueOnce(reason: unknown): this;

  /**
   * Return `this` context
   */
  mockReturnThis(): this;

  /**
   * Run a callback with a temporary implementation, restored once the callback returns or its
   * promise settles
   */
  withImplementation<R>(fn: T, callback: () => R): R;
}
