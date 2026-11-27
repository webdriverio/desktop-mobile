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

function skipRegex(s: string, i: number): number {
  if (s[i] !== '/' || i + 1 >= s.length || s[i + 1] === '/' || s[i + 1] === '*') {
    return i;
  }
  let j = i + 1;
  let inClass = false;
  while (j < s.length) {
    const ch = s[j];
    if (isLineTerminator(ch)) {
      return i;
    }
    if (ch === '\\') {
      if (j + 1 >= s.length || isLineTerminator(s[j + 1])) {
        return i;
      }
      j += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      j++;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      j++;
      continue;
    }
    if (ch === '/') {
      j++;
      while (j < s.length && /[A-Za-z]/.test(s[j])) {
        j++;
      }
      return j;
    }
    j++;
  }
  return i;
}

function skipWhitespaceAndComments(s: string, start: number): { index: number; sawNewline: boolean } {
  let i = start;
  let sawNewline = false;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) {
      if (isLineTerminator(s[i])) {
        sawNewline = true;
      }
      i++;
    }
    const next = skipComment(s, i);
    if (next !== i) {
      for (let k = i; k < next; k++) {
        if (isLineTerminator(s[k])) {
          sawNewline = true;
          break;
        }
      }
      i = next;
      continue;
    }
    break;
  }
  return { index: i, sawNewline };
}

function stripLeadingComments(s: string): string {
  return s.slice(skipWhitespaceAndComments(s, 0).index);
}

const REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'case',
  'throw',
  'delete',
  'void',
  'typeof',
  'in',
  'instanceof',
  'new',
  'of',
  'yield',
  'await',
  'else',
  'do',
]);

function scanJs(
  s: string,
  start: number,
  onToken: (c: string, i: number, depth: number, inTemplate: boolean) => boolean,
): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let canStartRegex = true;
  let prevDot = false;
  // Each frame: { inStr: true } = reading template string chars,
  //             { inStr: false, exprDepth: n } = inside ${} expression that opened at depth n.
  const tmpl: Array<{ inStr: boolean; exprDepth: number }> = [];

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    const topInStr = tmpl.length > 0 && tmpl[tmpl.length - 1].inStr;

    if (c === '\\' && (inSingle || inDouble || topInStr)) {
      i++;
      continue;
    }

    if (topInStr) {
      if (c === '`') {
        tmpl.pop();
        canStartRegex = false;
        prevDot = false;
      } else if (c === '$' && i + 1 < s.length && s[i + 1] === '{') {
        i++;
        depth++;
        tmpl[tmpl.length - 1].inStr = false;
        tmpl[tmpl.length - 1].exprDepth = depth;
        canStartRegex = true;
        prevDot = false;
      }
      continue;
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      if (!inSingle) {
        canStartRegex = false;
        prevDot = false;
      }
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      if (!inDouble) {
        canStartRegex = false;
        prevDot = false;
      }
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

    if (c === '/' && canStartRegex) {
      const afterRegex = skipRegex(s, i);
      if (afterRegex !== i) {
        i = afterRegex - 1;
        canStartRegex = false;
        prevDot = false;
        continue;
      }
    }

    if (/\s/.test(c)) {
      continue;
    }

    if (c === '`') {
      tmpl.push({ inStr: true, exprDepth: 0 });
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[\w$]/.test(s[j])) {
        j++;
      }
      const word = s.slice(i, j);
      canStartRegex = !prevDot && REGEX_PREFIX_KEYWORDS.has(word);
      prevDot = false;
      i = j - 1;
      continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (
        j < s.length &&
        (/[0-9a-zA-Z_.]/.test(s[j]) || ((s[j] === '+' || s[j] === '-') && (s[j - 1] === 'e' || s[j - 1] === 'E')))
      ) {
        j++;
      }
      canStartRegex = false;
      prevDot = false;
      i = j - 1;
      continue;
    }

    if (onToken(c, i, depth, tmpl.length > 0)) {
      return i;
    }

    prevDot = c === '.';
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      canStartRegex = true;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (tmpl.length > 0 && !tmpl[tmpl.length - 1].inStr && depth === tmpl[tmpl.length - 1].exprDepth - 1) {
        tmpl[tmpl.length - 1].inStr = true;
      } else {
        canStartRegex = c === '}';
      }
    } else if ((c === '+' && s[i + 1] === '+') || (c === '-' && s[i + 1] === '-')) {
      i++;
    } else {
      canStartRegex = true;
    }
  }
  return -1;
}

export function hasSemicolonOutsideQuotes(s: string): boolean {
  return scanJs(s, 0, (c, _i, depth) => c === ';' && depth === 0) !== -1;
}

export function hasTopLevelArrow(s: string): boolean {
  return scanJs(s, 0, (c, i, depth, inTemplate) => c === '=' && depth === 0 && !inTemplate && s[i + 1] === '>') !== -1;
}

function skipBalanced(s: string, start: number, open: string, close: string): number {
  if (s[start] !== open) {
    return -1;
  }
  const closeIdx = scanJs(s, start, (c, _i, depth, inTemplate) => !inTemplate && depth === 1 && c === close);
  return closeIdx === -1 ? -1 : closeIdx + 1;
}

function readIdentifier(s: string, start: number): { name: string; end: number } | undefined {
  if (start >= s.length || !/[A-Za-z_$]/.test(s[start])) {
    return undefined;
  }
  let end = start + 1;
  while (end < s.length && /[\w$]/.test(s[end])) {
    end++;
  }
  return { name: s.slice(start, end), end };
}

function isExpressionContinuation(s: string, index: number, sawNewline: boolean): boolean {
  if (index >= s.length) {
    return false;
  }
  const c = s[index];
  if (c === ';') {
    return false;
  }
  if (c === '.' || (c === '?' && s[index + 1] === '.')) {
    return true;
  }
  if (sawNewline) {
    if (c === '(') {
      const inner = skipWhitespaceAndComments(s, index + 1);
      return s[inner.index] === ')';
    }
    return false;
  }
  if ('([`*/%&|^<>?,'.includes(c)) {
    return true;
  }
  if (c === '+' || c === '-') {
    return s[index + 1] !== c;
  }
  if (c === '=' || c === '!') {
    return s[index + 1] === '=';
  }
  const ident = readIdentifier(s, index);
  return ident?.name === 'in' || ident?.name === 'instanceof';
}

function isDeclarationStatement(leading: string): boolean {
  const first = readIdentifier(leading, 0);
  if (!first) {
    return false;
  }

  let idx = first.end;
  let kind = first.name;

  if (kind === 'async') {
    const afterAsync = skipWhitespaceAndComments(leading, idx);
    if (afterAsync.sawNewline) {
      return false;
    }
    const next = readIdentifier(leading, afterAsync.index);
    if (next?.name !== 'function') {
      return false;
    }
    kind = 'function';
    idx = next.end;
  }

  if (kind === 'function') {
    idx = skipWhitespaceAndComments(leading, idx).index;
    if (leading[idx] === '*') {
      idx = skipWhitespaceAndComments(leading, idx + 1).index;
    }
    const name = readIdentifier(leading, idx);
    if (!name) {
      return false;
    }
    idx = skipWhitespaceAndComments(leading, name.end).index;
    const afterParams = skipBalanced(leading, idx, '(', ')');
    if (afterParams === -1) {
      return false;
    }
    idx = skipWhitespaceAndComments(leading, afterParams).index;
    const afterBody = skipBalanced(leading, idx, '{', '}');
    if (afterBody === -1) {
      return false;
    }
    const after = skipWhitespaceAndComments(leading, afterBody);
    return !isExpressionContinuation(leading, after.index, after.sawNewline);
  }

  if (kind === 'class') {
    idx = skipWhitespaceAndComments(leading, idx).index;
    const name = readIdentifier(leading, idx);
    if (!name || name.name === 'extends') {
      return false;
    }
    const bodyStart = scanJs(leading, name.end, (c, _i, depth, inTemplate) => !inTemplate && depth === 0 && c === '{');
    if (bodyStart === -1) {
      return false;
    }
    const afterBody = skipBalanced(leading, bodyStart, '{', '}');
    if (afterBody === -1) {
      return false;
    }
    const after = skipWhitespaceAndComments(leading, afterBody);
    return !isExpressionContinuation(leading, after.index, after.sawNewline);
  }

  return false;
}

const STATEMENT_KEYWORD = /^(?:const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/;

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
  if (
    leading.length === 0 ||
    STATEMENT_KEYWORD.test(leading) ||
    isDeclarationStatement(leading) ||
    hasSemicolonOutsideQuotes(leading)
  ) {
    return `${script}\n`;
  }
  return `return (${script}\n);`;
}
