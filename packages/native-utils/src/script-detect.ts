function isLineTerminator(c: string): boolean {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

function skipComment(s: string, i: number): number {
  if (s[i] !== '/' || i + 1 >= s.length) {
    return i;
  }
  if (s[i + 1] === '/') {
    let j = i + 2;
    while (j < s.length && !isLineTerminator(s[j])) {
      j++;
    }
    return j;
  }
  if (s[i + 1] === '*') {
    let j = i + 2;
    while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) {
      j++;
    }
    return j < s.length ? j + 2 : s.length;
  }
  return i;
}

function stripLeadingComments(s: string): string {
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) {
      i++;
    }
    const next = skipComment(s, i);
    if (next !== i) {
      i = next;
      continue;
    }
    break;
  }
  return s.slice(i);
}

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

    const afterComment = skipComment(s, i);
    if (afterComment !== i) {
      i = afterComment - 1;
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

    const afterComment = skipComment(s, i);
    if (afterComment !== i) {
      i = afterComment - 1;
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

const STATEMENT_KEYWORD =
  /^(?:(?:const|let|var|if|for|while|switch|throw|try|do|return|function|class)|async\s+function)(?=[^\w$]|$)/;

/** Whether a script is a function's source, which execute calls, rather than code to run as is. */
export function isFunctionSource(script: string): boolean {
  const s = stripLeadingComments(script);
  return (
    (s.startsWith('(') && hasTopLevelArrow(s)) ||
    /^function[\s(]/.test(s) ||
    (/^async[\s(]/.test(s) && (/^async\s+function\b/.test(s) || hasTopLevelArrow(s))) ||
    /^[A-Za-z_$][\w$]*\s*=>/.test(s)
  );
}

/**
 * Wrap a string script as a function body that returns its value.
 * Statement scripts run as-is; bare expressions are returned in parens so leading newlines
 * or comments cannot trigger ASI after `return`, and a trailing newline closes any `//` comment.
 */
export function wrapStringScriptBody(script: string): string {
  const leading = stripLeadingComments(script);
  if (leading.length === 0 || STATEMENT_KEYWORD.test(leading) || hasSemicolonOutsideQuotes(leading)) {
    return `${script}\n`;
  }
  return `return (${script}\n);`;
}
