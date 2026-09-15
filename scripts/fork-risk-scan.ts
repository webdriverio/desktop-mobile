// Static supply-chain risk scan for fork PRs, run BEFORE any secret reaches a runner. Reads the PR's
// changed files and diffs via the GitHub API — it never fetches or executes fork code, and nothing
// from the fork touches the runner. It arms the human review, which is the real control: findings are
// heuristics, so a clean scan never authorises a secret-bearing run on its own.
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

const REPO = process.env.REPO;
const PR = process.env.PR;
const SARIF_OUT = process.env.SARIF_OUT || 'fork-risk-scan.sarif';

if (!REPO || !PR) {
  console.error('REPO and PR are required');
  process.exit(1);
}

interface PrFile {
  filename: string;
  status: string;
  patch?: string;
}

// One file object per line (NDJSON) across all pages. gh uses GH_TOKEN from the environment.
const files: PrFile[] = execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}/files`, '--paginate', '--jq', '.[]'], {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as PrFile);

const findings: Finding[] = [];
const add = (file: string, line: number, level: Level, rule: string, message: string): void => {
  findings.push({ file, line, level, rule, message });
};

// Added lines from a GitHub API patch (hunks only — no +++/--- file headers), with new-file line
// numbers. Because there are no file headers, an added line whose content starts with '+' (e.g. '++i')
// is captured correctly rather than mistaken for a header.
interface AddedLine {
  line: number;
  content: string;
}
const addedLines = (patch: string | undefined): AddedLine[] => {
  if (!patch) return [];
  const out: AddedLine[] = [];
  let newLine = 0;
  for (const l of patch.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      newLine = Number(h[1]);
    } else if (l.startsWith('+')) {
      out.push({ line: newLine, content: l.slice(1) });
      newLine++;
    } else if (!l.startsWith('-') && !l.startsWith('\\')) {
      newLine++; // context line
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
    re: /CN_API_KEY|TURBO_TOKEN|DEPLOY_KEY|process\.env\b|std::env|printenv|env\s*\|/,
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

for (const { filename, status, patch } of files) {
  // Deletions add nothing executable — don't fire filename rules on them.
  if (status === 'removed') continue;
  const added = addedLines(patch);

  // Workflow / action files run with CI privileges — and in a keyed run resolve from the merged
  // branch, so a fork edit here could reach secrets.
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(filename) || /(^|\/)action\.ya?ml$/.test(filename)) {
    add(
      filename,
      1,
      'error',
      'ci/workflow-file',
      'Workflow/action file changed — runs with CI privileges. Scrutinise.',
    );
  }

  // Lockfile: flag non-registry sources (tarball / git / non-registry URL) — the top supply-chain
  // exfiltration vector. Plain registry entries carry only an integrity hash, so they don't match.
  if (/(^|\/)pnpm-lock\.yaml$/.test(filename)) {
    if (!patch) {
      add(
        filename,
        1,
        'warning',
        'dep/lockfile-changed',
        'Lockfile changed but the diff was too large for the API to return — review sources manually.',
      );
    } else {
      const nonRegistry = added.filter(
        ({ content }) =>
          /\b(tarball:|git\+|type:\s*git|\brepo:)/i.test(content) ||
          (/https?:\/\//.test(content) && !/registry\.(npmjs\.org|yarnpkg\.com)/i.test(content)),
      );
      add(
        filename,
        nonRegistry[0]?.line ?? 1,
        nonRegistry.length ? 'error' : 'note',
        'dep/lockfile-changed',
        nonRegistry.length
          ? `Lockfile adds ${nonRegistry.length} non-registry source(s) — inspect each.`
          : 'Lockfile changed (registry sources only).',
      );
    }
  }

  // package.json install-time lifecycle scripts added by this PR.
  if (/(^|\/)package\.json$/.test(filename)) {
    for (const { line, content } of added) {
      const m = /"(preinstall|install|postinstall|prepare|prepublish)"\s*:/.exec(content);
      if (m)
        add(
          filename,
          line,
          'error',
          'lifecycle/install-script',
          `Install-time lifecycle script "${m[1]}" added — runs automatically with the runner env. Inspect it.`,
        );
    }
  }

  // Rust build hooks run at compile time in the E2E job.
  if (/(^|\/)build\.rs$/.test(filename))
    add(
      filename,
      1,
      'error',
      'rust/build-script',
      'Rust build.rs changed — executes at compile time in the E2E job. Inspect for network/env access.',
    );
  if (/(^|\/)Cargo\.toml$/.test(filename)) {
    for (const { line, content } of added) {
      // A build-dependencies header (a new section) OR a non-registry source (git/path) added in any
      // section — both run fork-controlled code at build/test time. Keying only on the section header
      // would miss a dep added under a pre-existing header, so flag the source markers too.
      if (/\[build-dependencies\]/.test(content))
        add(
          filename,
          line,
          'warning',
          'rust/build-deps',
          'Cargo [build-dependencies] added — runs at compile time. Review.',
        );
      else if (/\b(git|path)\s*=/.test(content))
        add(
          filename,
          line,
          'warning',
          'rust/non-registry-dep',
          'Non-registry Rust dependency (git/path) added — runs code at build/test time. Review.',
        );
    }
  }

  // Exfiltration-shaped patterns in added lines of ANY changed file (all matches).
  for (const { line, content } of added) {
    for (const { rule, re, level, msg } of exfilPatterns) {
      if (re.test(content)) add(filename, line, level, rule, msg);
    }
  }

  // A code/script file or manifest with no patch (too large for the API) escaped content scanning —
  // flag it so an oversized package.json (lifecycle scripts) / Cargo.toml / script isn't a blind spot.
  if (
    !patch &&
    (/\.(ts|tsx|cts|mts|js|jsx|mjs|cjs|rs|sh|bash|zsh|ps1|psm1|bat|cmd|py|rb)$/.test(filename) ||
      /(^|\/)(package\.json|Cargo\.toml)$/.test(filename))
  ) {
    add(
      filename,
      1,
      'warning',
      'scan/unscanned',
      'Changed file too large for the API to return a diff — content not scanned; review manually.',
    );
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
