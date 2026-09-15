// Static supply-chain risk scan for fork PRs, run BEFORE any secret reaches a runner. Reads the
// PR's changed files (never executes them) to arm the human review, which is the real control:
// findings are heuristics, so a clean scan never authorises a secret-bearing run on its own.
// See docs/security/crabnebula-fork-verification.md for the flow that consumes it.

import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

type Level = 'error' | 'warning' | 'note';
interface Finding {
  file: string;
  line: number;
  level: Level;
  rule: string;
  message: string;
}

const BASE = process.env.BASE_SHA;
const HEAD = process.env.HEAD_SHA;
const SARIF_OUT = process.env.SARIF_OUT || 'fork-risk-scan.sarif';

if (!BASE || !HEAD) {
  console.error('BASE_SHA and HEAD_SHA are required');
  process.exit(1);
}

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const changedFiles = git(['diff', '--name-only', `${BASE}...${HEAD}`])
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

const findings: Finding[] = [];
const add = (file: string, line: number, level: Level, rule: string, message: string): void => {
  findings.push({ file, line, level, rule, message });
};

// The working tree is the base checkout, so read the fork's version from git objects — this
// keeps the fork's files off disk entirely.
const safeRead = (file: string): string => {
  try {
    return execFileSync('git', ['show', `${HEAD}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return '';
  }
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

// Lockfile changes are the top supply-chain exfiltration vector.
if (changedFiles.includes('pnpm-lock.yaml')) {
  let addedDepLines: string[] = [];
  try {
    addedDepLines = git(['diff', `${BASE}...${HEAD}`, '--', 'pnpm-lock.yaml'])
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  } catch {
    /* ignore */
  }
  const nonRegistry = addedDepLines.filter(
    (l) => /(resolution|tarball|git\+|https?:\/\/)/i.test(l) && !/registry\.npmjs\.org|npmjs\.com/i.test(l),
  );
  add(
    'pnpm-lock.yaml',
    1,
    nonRegistry.length ? 'error' : 'warning',
    'dep/lockfile-changed',
    `pnpm-lock.yaml changed (${addedDepLines.length} added lines).${nonRegistry.length ? ` ${nonRegistry.length} reference a non-npm source — inspect each.` : ''}`,
  );
}

for (const file of changedFiles) {
  if (/(^|\/)package\.json$/.test(file)) {
    const text = safeRead(file);
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
      const re = new RegExp(`"${hook}"\\s*:`);
      const m = re.exec(text);
      if (m)
        add(
          file,
          lineOf(text, m.index),
          'error',
          'lifecycle/install-script',
          `Install-time lifecycle script "${hook}" present — runs automatically with the runner env. Inspect it.`,
        );
    }
  }

  if (/(^|\/)build\.rs$/.test(file))
    add(
      file,
      1,
      'error',
      'rust/build-script',
      'Rust build.rs changed — executes at compile time in the E2E job. Inspect for network/env access.',
    );
  if (/(^|\/)Cargo\.toml$/.test(file)) {
    const text = safeRead(file);
    const m = /\[build-dependencies\]/.exec(text);
    if (m)
      add(
        file,
        lineOf(text, m.index),
        'warning',
        'rust/build-deps',
        'Cargo [build-dependencies] present — runs at compile time. Review additions.',
      );
  }

  // Exfiltration-shaped patterns in any changed source.
  if (/\.(ts|tsx|js|mjs|cjs|rs|sh|bash|yml|yaml|toml)$/.test(file)) {
    const text = safeRead(file);
    const patterns: { rule: string; re: RegExp; level: Level; msg: string }[] = [
      {
        rule: 'net/outbound-command',
        re: /\b(curl|wget|nc|netcat|scp|Invoke-WebRequest|iwr)\b/,
        level: 'warning',
        msg: 'Outbound network command in a changed file.',
      },
      {
        rule: 'net/http-client',
        re: /\b(fetch|XMLHttpRequest|https?\.request|net\.connect|reqwest|ureq)\b/,
        level: 'note',
        msg: 'HTTP/socket client usage in a changed file.',
      },
      {
        rule: 'secret/env-read',
        re: /CN_API_KEY|process\.env\s*\[|std::env::var|printenv|env\s*\|/,
        level: 'warning',
        msg: 'Environment/secret access in a changed file.',
      },
      {
        rule: 'obfuscation/encode',
        re: /base64|atob|btoa|Buffer\.from\([^)]*base64|from_base64|toString\(['"]base64/,
        level: 'note',
        msg: 'Encoding routine in a changed file — can hide exfiltrated data.',
      },
    ];
    for (const { rule, re, level, msg } of patterns) {
      const m = re.exec(text);
      if (m) add(file, lineOf(text, m.index), level, rule, msg);
    }
  }
}

const sarif = {
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'fork-risk-scan',
          informationUri:
            'https://github.com/webdriverio/desktop-mobile/blob/main/docs/security/crabnebula-fork-verification.md',
          rules: [],
        },
      },
      results: findings.map((f) => ({
        ruleId: f.rule,
        level: f.level,
        message: { text: f.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }],
      })),
    },
  ],
};

writeFileSync(SARIF_OUT, JSON.stringify(sarif, null, 2));

const high = findings.filter((f) => f.level === 'error').length;
console.error(`findings=${findings.length} high=${high}`);
for (const f of findings) console.error(`  [${f.level}] ${f.rule} ${f.file}:${f.line} — ${f.message}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nhigh=${high}\n`);
}
