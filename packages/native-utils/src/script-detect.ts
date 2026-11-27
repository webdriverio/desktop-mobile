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

// False once a Content Security Policy without 'unsafe-eval' blocks compiling, so a page logs that violation once
// rather than on every call.
let canCompile = true;

// Undefined when the script can't be judged: compiling is blocked, or fails some other way, such as a script nested
// too deeply for the compiler's stack.
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

const IDENTIFIER = /^[$_\p{ID_Start}][$\p{ID_Continue}\u200C\u200D]*/u;

/** Whether a script is a function's source, which execute calls, rather than code to run as is. */
export function isFunctionSource(script: string): boolean {
  const s = skipLeadingWhitespaceAndComments(script).trim();
  if (/^function[\s(]/.test(s) || /^async\s+function\b/.test(s)) {
    return true;
  }
  const param = IDENTIFIER.exec(s)?.[0];
  const looksLikeArrow =
    ((s.startsWith('(') || /^async[\s(]/.test(s)) && hasTopLevelArrow(s)) ||
    (param !== undefined && skipLeadingWhitespaceAndComments(s.slice(param.length)).startsWith('=>'));
  if (!looksLikeArrow || compiles(`return (${s}\n);`) !== true) {
    return looksLikeArrow;
  }
  // `hasTopLevelArrow` also finds an arrow in a comment. An arrow function can't follow `void` unparenthesized,
  // so `void (1 + 2) // =>` compiles and `void (a) => a` doesn't.
  return compiles(`return void ${s}\n;`) !== true;
}

function isExpression(script: string): boolean {
  const inParens = compiles(`return (${script}\n);`);
  const s = skipLeadingWhitespaceAndComments(script);
  if (inParens === true) {
    // A script that compiles in parens but not in brackets, such as `1); run(); (2`, closed the parens.
    const inBrackets = compiles(`return [${script}\n];`);
    if (inBrackets === false) {
      return false;
    }
    if (inBrackets === true) {
      // A lone declaration is a statement in a function body, so it returns undefined, as in chromedriver.
      return !(/^(async\s+function|function|class)(?=[^\w$]|$)/.test(s) && compiles(`${script}\n`) === true);
    }
  }
  if (inParens === false && compiles(`${script}\n`) === true) {
    return false;
  }
  // The app's engine may parse syntax this runtime can't, so a script that compiles neither way isn't judged here.
  return (
    s.length > 0 &&
    !/^(const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/.test(s) &&
    !hasSemicolonOutsideQuotes(s)
  );
}

/**
 * Wraps a string script as a function body that returns its value. The script runs as an expression
 * when it compiles as one and isn't a lone function or class declaration, and as is otherwise.
 * Where compiling is blocked, or the script compiles neither way, a statement keyword or a top-level semicolon
 * makes it run as is.
 * The newline before each closing bracket ends a trailing `//` comment.
 */
export function wrapStringScriptBody(script: string): string {
  return isExpression(script) ? `return (${script}\n);` : `${script}\n`;
}
