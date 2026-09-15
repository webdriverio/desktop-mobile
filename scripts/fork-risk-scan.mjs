// Static risk scan for fork PRs touching the Tauri service, run BEFORE CN_API_KEY reaches a
// runner. Reads the PR's changed files (never executes them) to arm the human review, which is
// the real control: findings are heuristics, so a clean scan never authorises a keyed run on its
// own. See docs/security/crabnebula-fork-verification.md.
//
// Plain .mjs, not a typed scripts/*.ts, so it stays off the classifier's typecheck/test surface.

import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_SHA;
const HEAD = process.env.HEAD_SHA;
const SARIF_OUT = process.env.SARIF_OUT || 'fork-risk-scan.sarif';

if (!BASE || !HEAD) {
  console.error('BASE_SHA and HEAD_SHA are required');
  process.exit(1);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const changedFiles = git(['diff', '--name-only', `${BASE}...${HEAD}`])
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

// Which changed paths leave macOS CrabNebula as the uncovered surface on a fork PR. Duplicated
// from scripts/detect-changes.ts run_tauri on purpose: the privileged scanner can't read that job.
const TAURI_GLOBS = [
  /^packages\/tauri-service\//,
  /^packages\/tauri-plugin/,
  /^fixtures\/e2e-apps\/tauri\//,
  /^e2e\/.*tauri/i,
];
// Shared packages affect Tauri too.
const SHARED_GLOBS = [/^packages\/native-(utils|types|cdp-bridge|spy)\//, /^pnpm-lock\.yaml$/, /^package\.json$/];
const CRABNEBULA_GLOBS = [
  /crabnebula/i,
  /^packages\/tauri-service\/src\/(driverManager|pluginValidator)\.ts$/,
  /^packages\/tauri-service\/docs\/crabnebula-setup\.md$/,
];

const matchesAny = (file, globs) => globs.some((re) => re.test(file));

const tauriTouched = changedFiles.some((f) => matchesAny(f, TAURI_GLOBS) || matchesAny(f, SHARED_GLOBS));
const crabnebulaTouched = changedFiles.some((f) => matchesAny(f, CRABNEBULA_GLOBS));
const tier = crabnebulaTouched ? 'hard' : tauriTouched ? 'soft' : 'none';

/** @type {{file: string, line: number, level: 'error'|'warning'|'note', rule: string, message: string}[]} */
const findings = [];
const add = (file, line, level, rule, message) => findings.push({ file, line, level, rule, message });

// The working tree is the base checkout, so read the fork's version from git objects — this
// keeps the fork's files off disk entirely.
const safeRead = (file) => {
  try {
    return execFileSync('git', ['show', `${HEAD}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return '';
  }
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Lockfile changes are the top supply-chain exfiltration vector.
if (changedFiles.includes('pnpm-lock.yaml')) {
  let addedDepLines = [];
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
    const patterns = [
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
          name: 'crabnebula-fork-risk-scan',
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
console.error(
  `tier=${tier} findings=${findings.length} high=${high} tauri=${tauriTouched} crabnebula=${crabnebulaTouched}`,
);
for (const f of findings) console.error(`  [${f.level}] ${f.rule} ${f.file}:${f.line} — ${f.message}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `tier=${tier}\nfindings=${findings.length}\nhigh=${high}\ntauri=${tauriTouched}\ncrabnebula=${crabnebulaTouched}\n`,
  );
}
