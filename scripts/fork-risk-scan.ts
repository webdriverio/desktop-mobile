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

// Added lines only, with real new-file line numbers from the hunk headers, so findings reflect what
// the PR introduces rather than pre-existing content.
interface AddedLine {
  line: number;
  content: string;
}
const addedLines = (file: string): AddedLine[] => {
  let raw = '';
  try {
    raw = git(['diff', '--unified=0', `${BASE}...${HEAD}`, '--', file]);
  } catch {
    return [];
  }
  const out: AddedLine[] = [];
  let newLine = 0;
  for (const l of raw.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      newLine = Number(h[1]);
      continue;
    }
    if (l.startsWith('+++')) continue;
    if (l.startsWith('+')) {
      out.push({ line: newLine, content: l.slice(1) });
      newLine++;
    }
  }
  return out;
};

const exfilPatterns: { rule: string; re: RegExp; level: Level; msg: string }[] = [
  {
    rule: 'net/outbound-command',
    re: /\b(curl|wget|nc|netcat|scp|Invoke-WebRequest|iwr)\b/,
    level: 'warning',
    msg: 'Outbound network command in an added line.',
  },
  {
    rule: 'net/http-client',
    re: /\b(fetch|XMLHttpRequest|https?\.request|net\.connect|reqwest|ureq)\b/,
    level: 'note',
    msg: 'HTTP/socket client usage in an added line.',
  },
  {
    rule: 'secret/env-read',
    re: /CN_API_KEY|process\.env\s*\[|std::env::var|printenv|env\s*\|/,
    level: 'warning',
    msg: 'Environment/secret access in an added line.',
  },
  {
    rule: 'obfuscation/encode',
    re: /base64|atob|btoa|Buffer\.from\([^)]*base64|from_base64|toString\(['"]base64/,
    level: 'note',
    msg: 'Encoding routine in an added line — can hide exfiltrated data.',
  },
];

for (const file of changedFiles) {
  // Workflow / action files run with CI privileges — and in a keyed run resolve from the merged
  // branch, so a fork edit here could reach secrets.
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(file) || /(^|\/)action\.ya?ml$/.test(file)) {
    add(file, 1, 'error', 'ci/workflow-file', 'Workflow/action file changed — runs with CI privileges. Scrutinise.');
  }

  // Lockfile: flag non-registry sources (tarball / git / non-registry URL) — the top supply-chain
  // exfiltration vector. Plain registry entries carry only an integrity hash, so they don't match.
  if (/(^|\/)pnpm-lock\.yaml$/.test(file)) {
    const nonRegistry = addedLines(file).filter(
      ({ content }) =>
        /\b(tarball:|git\+|type:\s*git|\brepo:)/i.test(content) ||
        (/https?:\/\//.test(content) && !/registry\.(npmjs\.org|yarnpkg\.com)/i.test(content)),
    );
    add(
      file,
      nonRegistry[0]?.line ?? 1,
      nonRegistry.length ? 'error' : 'note',
      'dep/lockfile-changed',
      nonRegistry.length
        ? `Lockfile adds ${nonRegistry.length} non-registry source(s) — inspect each.`
        : 'Lockfile changed (registry sources only).',
    );
  }

  if (/(^|\/)package\.json$/.test(file)) {
    for (const { line, content } of addedLines(file)) {
      const m = /"(preinstall|install|postinstall|prepare|prepublish)"\s*:/.exec(content);
      if (m)
        add(
          file,
          line,
          'error',
          'lifecycle/install-script',
          `Install-time lifecycle script "${m[1]}" added — runs automatically with the runner env. Inspect it.`,
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
    for (const { line, content } of addedLines(file)) {
      if (/\[build-dependencies\]/.test(content)) {
        add(
          file,
          line,
          'warning',
          'rust/build-deps',
          'Cargo [build-dependencies] added — runs at compile time. Review.',
        );
        break;
      }
    }
  }

  // Exfiltration-shaped patterns in added lines (all matches).
  if (/\.(ts|tsx|js|mjs|cjs|rs|sh|bash|yml|yaml|toml)$/.test(file)) {
    for (const { line, content } of addedLines(file)) {
      for (const { rule, re, level, msg } of exfilPatterns) {
        if (re.test(content)) add(file, line, level, rule, msg);
      }
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
