export function hasSemicolonOutsideQuotes(s: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  // Each frame: { inStr: true } = reading template string chars,
  //             { inStr: false, exprDepth: n } = inside ${} expression that opened at depth n.
  const tmpl: Array<{ inStr: boolean; exprDepth: number }> = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const topInStr = tmpl.length > 0 && tmpl[tmpl.length - 1].inStr;

    if (c === '\\' && (inSingle || inDouble || topInStr)) {
      i++;
      continue;
    }

    if (topInStr) {
      if (c === '`') {
        tmpl.pop();
      } else if (c === '$' && i + 1 < s.length && s[i + 1] === '{') {
        i++;
        depth++;
        tmpl[tmpl.length - 1].inStr = false;
        tmpl[tmpl.length - 1].exprDepth = depth;
      }
      continue;
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }

    if (c === '`') {
      tmpl.push({ inStr: true, exprDepth: 0 });
      continue;
    }

    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (tmpl.length > 0 && !tmpl[tmpl.length - 1].inStr && depth === tmpl[tmpl.length - 1].exprDepth - 1) {
        tmpl[tmpl.length - 1].inStr = true;
      }
    } else if (c === ';' && depth === 0) {
      return true;
    }
  }
  return false;
}

export function hasTopLevelArrow(s: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  const tmpl: Array<{ inStr: boolean; exprDepth: number }> = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const topInStr = tmpl.length > 0 && tmpl[tmpl.length - 1].inStr;

    if (c === '\\' && (inSingle || inDouble || topInStr)) {
      i++;
      continue;
    }

    if (topInStr) {
      if (c === '`') {
        tmpl.pop();
      } else if (c === '$' && i + 1 < s.length && s[i + 1] === '{') {
        i++;
        depth++;
        tmpl[tmpl.length - 1].inStr = false;
        tmpl[tmpl.length - 1].exprDepth = depth;
      }
      continue;
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }

    if (c === '`') {
      tmpl.push({ inStr: true, exprDepth: 0 });
      continue;
    }

    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (tmpl.length > 0 && !tmpl[tmpl.length - 1].inStr && depth === tmpl[tmpl.length - 1].exprDepth - 1) {
        tmpl[tmpl.length - 1].inStr = true;
      }
    } else if (c === '=' && depth === 0 && tmpl.length === 0 && i + 1 < s.length && s[i + 1] === '>') {
      return true;
    }
  }
  return false;
}

function skipLeadingWhitespaceAndComments(s: string): string {
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
    } else if (s.startsWith('//', i)) {
      const end = s.slice(i).search(/[\n\r\u2028\u2029]/);
      i = end === -1 ? s.length : i + end;
    } else if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
    } else {
      break;
    }
  }
  return s.slice(i);
}

const AsyncFunction = (async () => {}).constructor as new (body: string) => unknown;

// False once compiling is blocked, by a Content Security Policy or Node's --disallow-code-generation-from-strings,
// so it isn't attempted again.
let canCompile = true;

// Undefined when compiling is blocked or fails another way, as for a script nested too deeply for the compiler.
function compiles(body: string): boolean | undefined {
  if (!canCompile) {
    return undefined;
  }
  try {
    new AsyncFunction(body);
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false;
    }
    if (error instanceof EvalError) {
      canCompile = false;
    }
    return undefined;
  }
}

export interface ScriptDetectOptions {
  /**
   * Whether to compile the script, without running it, to classify it. Defaults to true. Pass false in an app's
   * page, where a Content Security Policy without 'unsafe-eval' reports each attempt.
   */
  compile?: boolean;
}

type Compile = (body: string) => boolean | undefined;

const compilerFor = (options?: ScriptDetectOptions): Compile =>
  options?.compile === false ? () => undefined : compiles;

const IDENTIFIER = /^[$_\p{ID_Start}][$\p{ID_Continue}\u200C\u200D]*/u;

/** Whether a script is a function's source, which execute calls, rather than code to run as is. */
export function isFunctionSource(script: string, options?: ScriptDetectOptions): boolean {
  const s = skipLeadingWhitespaceAndComments(script).trim();
  const isFunction = /^function[\s(]/.test(s) || /^async\s+function(?![$\p{ID_Continue}\u200C\u200D])/u.test(s);
  const param = IDENTIFIER.exec(s)?.[0];
  const looksLikeArrow =
    ((s.startsWith('(') || /^async[\s(]/.test(s)) && hasTopLevelArrow(s)) ||
    (param !== undefined && skipLeadingWhitespaceAndComments(s.slice(param.length)).startsWith('=>'));
  if (!isFunction && !looksLikeArrow) {
    return false;
  }
  const compile = compilerFor(options);
  const asExpression = compile(`return (${s}\n);`);
  if (asExpression === false) {
    // Statements after the function, as in `function foo() {}\nreturn foo()`, make the script a body.
    return compile(`${s}\n`) !== true;
  }
  if (asExpression === undefined || isFunction) {
    return true;
  }
  // `hasTopLevelArrow` also finds an arrow in a comment. An arrow function can't follow `void` unparenthesized,
  // so `void (1 + 2) // =>` compiles and `void (a) => a` doesn't.
  return compile(`return void ${s}\n;`) !== true;
}

function isExpression(script: string, compiles: Compile): boolean {
  const inParens = compiles(`return (${script}\n);`);
  const s = skipLeadingWhitespaceAndComments(script);
  if (inParens === true) {
    // A script that compiles in parens but not in brackets, such as `1); run(); (2`, has closed the parens.
    const inBrackets = compiles(`return [${script}\n];`);
    if (inBrackets === false) {
      return false;
    }
    if (inBrackets === true) {
      // A lone declaration is a statement in a function body, so it returns undefined, as in chromedriver.
      return !(
        /^(?:async\s+function|function|class)(?![$\p{ID_Continue}\u200C\u200D])/u.test(s) &&
        compiles(`${script}\n`) === true
      );
    }
  }
  if (inParens === false && compiles(`${script}\n`) === true) {
    return false;
  }
  // Compiling is blocked, or failed both ways on syntax the app's engine may parse: check keywords and semicolons.
  return (
    s.length > 0 &&
    !/^(?:const|let|var|if|for|while|switch|throw|try|do|return)(?![$\p{ID_Continue}\u200C\u200D])/u.test(s) &&
    !hasSemicolonOutsideQuotes(s)
  );
}

/**
 * Wraps a string script as a function body that returns its value. An expression is returned, and anything else,
 * a lone function or class declaration included, runs as is. Where the script can't be compiled, a leading statement
 * keyword or a top-level semicolon marks it as statements. A trailing `//` comment can't hide the closing bracket.
 */
export function wrapStringScriptBody(script: string, options?: ScriptDetectOptions): string {
  return isExpression(script, compilerFor(options)) ? `return (${script}\n);` : `${script}\n`;
}
