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
  additions?: number;
}

// One file object per line (NDJSON) across all pages. gh uses GH_TOKEN from the environment.
// Intentionally NOT wrapped: without the file list there is nothing to scan, so a failure here should
// hard-error (the workflow then posts a red "scan errored" status) rather than pass a false-clean scan.
// The changed_files count below is optional, so it degrades to a warning instead.
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

// The Files API caps at 3000 files. Key the truncation flag on that cap (total > 3000), not on
// total != files.length — the changed_files count can legitimately diverge from the list length on
// large diffs (binary/rename accounting) without anything being truncated.
try {
  const total = Number(
    execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}`, '--jq', '.changed_files'], { encoding: 'utf8' }).trim(),
  );
  if (Number.isFinite(total) && total > 3000) {
    add(
      '',
      1,
      'error',
      'scan/truncated',
      `PR changed ${total} files; only ${files.length} scanned (API cap) — review the rest manually.`,
    );
  }
} catch {
  // Can't confirm completeness — surface it rather than silently passing a possibly-truncated scan.
  add(
    '',
    1,
    'warning',
    'scan/count-unavailable',
    'Could not fetch the file count — scan completeness is unverified; review manually.',
  );
}

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

// Exfiltration signal categories. Bare `process.env` / `fetch` are too common in this codebase to
// flag on their own (they'd flood the advisory list), so env-reads are only surfaced when paired with
// a network call in the same file; named secrets and outbound shell commands are high-signal enough
// to flag alone.
const rx = {
  secret: /CN_API_KEY|TURBO_TOKEN|DEPLOY_KEY|printenv/,
  outbound: /\b(curl|wget|nc|netcat|scp|Invoke-WebRequest|iwr)\b/,
  envRead: /process\.env\b|std::env/,
  http: /\b(fetch|XMLHttpRequest|https?\.request|net\.connect|reqwest|ureq)\b/,
  encode: /base64|atob|btoa|from_base64/,
};

for (const { filename, status, patch, additions } of files) {
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
          // Anchor the registry host to //<host>/ so a lookalike like registry.npmjs.org.evil.com
          // (substring match) doesn't slip past the non-registry catch-all.
          (/https?:\/\//.test(content) && !/\/\/(registry\.npmjs\.org|registry\.yarnpkg\.com)\//i.test(content)),
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
      // A git/path SOURCE value (URL, or a filesystem path with a slash) in either the inline-table
      // `{ git = "url" }` or expanded `[deps.x]\ngit = "url"` form. Matches the source, not a bare
      // version, so a registry crate literally named `git`/`path` (git = "0.2") doesn't false-positive.
      else if (/\bgit\s*=\s*["'][^"']*(:\/\/|@|\.git)/.test(content) || /\bpath\s*=\s*["'][^"']*\//.test(content))
        add(
          filename,
          line,
          'warning',
          'rust/non-registry-dep',
          'Non-registry Rust dependency (git/path source) added — runs code at build/test time. Review.',
        );
    }
  }

  // Exfiltration signal from added lines: named secrets and outbound shell commands alone; env-reads
  // only when paired with a network call in the same file; encoding only near env/secret access.
  // Skip docs/text — they aren't executed, and mentioning curl/CN_API_KEY in prose isn't exfiltration.
  const isDoc = /\.(md|markdown|mdx|txt|rst)$/i.test(filename);
  const first = (re: RegExp): AddedLine | undefined =>
    isDoc ? undefined : added.find(({ content }) => re.test(content));
  const sec = first(rx.secret);
  const out = first(rx.outbound);
  const env = first(rx.envRead);
  const http = first(rx.http);
  const enc = first(rx.encode);
  if (sec)
    add(
      filename,
      sec.line,
      'warning',
      'secret/named',
      'A named secret (CN_API_KEY/TURBO_TOKEN/DEPLOY_KEY) is referenced in an added line.',
    );
  if (out) add(filename, out.line, 'warning', 'net/outbound-command', 'Outbound network command in an added line.');
  if (env && (out || http))
    add(
      filename,
      env.line,
      'warning',
      'exfil/env-egress',
      'Environment read alongside a network call in this file — possible exfiltration shape.',
    );
  if (enc && (sec || env))
    add(
      filename,
      enc.line,
      'note',
      'obfuscation/encode',
      'Encoding near env/secret access — can hide exfiltrated data.',
    );

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

  // A present-but-truncated patch (GitHub caps very large patches) is only partially scanned — the
  // returned added-line count falls short of the file's total additions. Flag the blind spot.
  if (patch && typeof additions === 'number' && added.length < additions) {
    add(
      filename,
      1,
      'warning',
      'scan/partial-diff',
      `Only ${added.length} of ${additions} added lines were in the diff — the rest are unscanned; review manually.`,
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
      results: findings.map((f) => {
        const result: {
          ruleId: string;
          level: Level;
          message: { text: string };
          locations?: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[];
        } = { ruleId: f.rule, level: f.level, message: { text: f.message } };
        // PR-level findings (e.g. truncation) have no file — SARIF allows a result without locations.
        if (f.file) {
          result.locations = [
            { physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } },
          ];
        }
        return result;
      }),
    },
  ],
};

writeFileSync(SARIF_OUT, JSON.stringify(sarif, null, 2));

const high = findings.filter((f) => f.level === 'error').length;
// Only the counts go to the (public) run log — the per-finding detail goes to the private SARIF, so
// the log isn't a detection oracle a prober can iterate against.
console.error(`findings=${findings.length} high=${high}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings.length}\nhigh=${high}\n`);
}
