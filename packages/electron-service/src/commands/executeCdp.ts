import * as babelParser from '@babel/parser';
import { createLogger, isMultiremote } from '@wdio/native-utils';

const log = createLogger('electron-service', 'service');

import { hasSemicolonOutsideQuotes, hasTopLevelArrow } from '@wdio/native-utils';
import { parse, print } from 'recast';
import type { ElectronCdpBridge } from '../bridge';
import mockStore from '../mockStore.js';
import { isInternalCommand } from '../utils.js';

const CACHE_MAX_SIZE = 100;
const cache = new Map<string, string>();

export function clearParsedFunctionCache(): void {
  cache.clear();
}

export async function execute<ReturnValue, InnerArguments extends unknown[]>(
  browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  cdpBridge: ElectronCdpBridge | undefined,
  script: string | ((electron: typeof Electron.CrossProcessExports, ...innerArgs: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<ReturnValue | ReturnValue[] | undefined> {
  if (typeof script !== 'string' && typeof script !== 'function') {
    throw new Error('Expecting script to be type of "string" or "function"');
  }

  if (!browser) {
    throw new Error('WDIO browser is not yet initialised');
  }

  if (isMultiremote(browser)) {
    const mrBrowser = browser as unknown as WebdriverIO.MultiRemoteBrowser;
    return await Promise.all(
      mrBrowser.instances.map(async (instance) => {
        const mrInstance = mrBrowser.getInstance(instance);
        return mrInstance.electron.execute(script, ...args);
      }),
    );
  }

  if (!cdpBridge) {
    log.error('CDP Bridge is not available - browser.electron.execute() cannot access the main process');
    log.error('This may occur if the EnableNodeCliInspectArguments fuse is disabled in your Electron binary');
    log.error('See: https://www.electronjs.org/docs/latest/tutorial/fuses#nodecliinspect');
    return undefined;
  }

  // Handle string scripts - wrap them in async IIFE before parsing
  // This prevents recast from trying to parse them as function definitions
  // Only pass through to recast if it's clearly a function-like string that needs transformation
  let functionDeclaration: string;
  if (typeof script === 'string') {
    const trimmed = script.trim();
    // Route function-like strings through recast so the electron param is stripped.
    // Covers: (e, ...args) => ..., async (e, ...args) => ..., function(e) {...}, async function(e) {...}
    const isFunctionLike =
      /^(async\s+)?function\b/.test(trimmed) ||
      ((trimmed.startsWith('(') || /^async\s*\(/.test(trimmed)) && hasTopLevelArrow(trimmed));

    if (isFunctionLike) {
      // Anonymous function expressions (function(...){}) are only valid in expression context.
      // Babel rejects them at statement level ("Unexpected token"), so wrap in parens first.
      // Named declarations (function foo(...){}) and arrow functions parse fine as-is.
      const needsParens = /^(async\s+)?function\s*\(/.test(trimmed);
      functionDeclaration = getCachedOrParse(needsParens ? `(${script.trim()})` : script);
    } else {
      functionDeclaration = wrapStringScriptForCdp(script);
    }
  } else {
    functionDeclaration = getCachedOrParse(script.toString());
  }

  const argsArray = args.map((arg) => ({ value: arg }));

  log.debug('Executing script length:', Buffer.byteLength(functionDeclaration, 'utf-8'));

  const result = await cdpBridge.send('Runtime.callFunctionOn', {
    functionDeclaration,
    arguments: argsArray,
    awaitPromise: true,
    returnByValue: true,
    executionContextId: cdpBridge.contextId,
  });

  let executionError: Error | undefined;
  if (!isInternalCommand(args) && result.exceptionDetails) {
    const message =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Script execution failed';
    executionError = new Error(message);
  }

  await syncMockStatus(args);

  if (executionError) {
    throw executionError;
  }

  return result.result.value as ReturnValue;
}

/**
 * Wrap string scripts in async IIFE for proper CDP execution
 * Handles statement and expression scripts that would otherwise fail parsing
 */
function wrapStringScriptForCdp(script: string): string {
  const trimmed = script.trim();

  // For string scripts, wrap them to avoid parsing errors:
  // - "function() {}" (recast handles these differently)
  // - "1 + 2 + 3" (expression - would be called as function)
  // - "return 42" (statement - parsing error)
  // - "const x = 1" (statement - parsing error)

  const hasStatementKeyword = /^(const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/.test(trimmed);
  const hasRealSemicolon = hasSemicolonOutsideQuotes(trimmed);

  if (hasRealSemicolon || hasStatementKeyword) {
    return `async function() { ${script} }`;
  } else {
    return `async function() { return (${script}) }`;
  }
}

async function syncMockStatus(args: unknown[]) {
  const mocks = mockStore.getMocks();
  if (mocks.length > 0 && !isInternalCommand(args)) {
    await Promise.all(mocks.map(async ([_mockId, mock]) => mock.update()));
  }
}

function getCachedOrParse(funcStr: string): string {
  const cached = cache.get(funcStr);
  if (cached) {
    return cached;
  }

  const result = stripElectronParameter(funcStr);

  if (cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  cache.set(funcStr, result);

  return result;
}

function stripElectronParameter(funcStr: string): string {
  const ast = parse(funcStr, {
    parser: {
      parse: (source: string) =>
        babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript'],
        }),
    },
  });

  const topLevelNode = ast.program.body[0];
  let funcNode = null;

  if (topLevelNode.type === 'ExpressionStatement') {
    // Arrow function
    funcNode = topLevelNode.expression;
  } else if (topLevelNode.type === 'FunctionDeclaration') {
    // Function declaration
    funcNode = topLevelNode;
  }

  if (!funcNode) {
    throw new Error('Unsupported function type');
  }

  // Remove first arg if it exists
  if ('params' in funcNode && Array.isArray(funcNode.params)) {
    funcNode.params.shift();
  }

  return print(ast).code;
}
