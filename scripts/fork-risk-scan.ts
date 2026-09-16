// Static supply-chain risk scan for fork PRs, run BEFORE any secret reaches a runner. Reads the PR's
// files and diffs via the GitHub API — it never fetches or executes fork code. It arms the human
// review, which is the real control: findings are heuristics, so a clean scan never authorises a
// secret-bearing run on its own. See docs/security/crabnebula-fork-verification.md for the flow.

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

// One file object per line (NDJSON via --jq '.[]') across all pages. Intentionally NOT wrapped: without
// the file list there is nothing to scan, so hard-error (the workflow posts a red "scan errored"
// status) rather than pass a false-clean scan.
const files: PrFile[] = execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}/files`, '--paginate', '--jq', '.[]'], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024, // headroom over the 3000-file cap's worth of large patches
})
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as PrFile);

const findings: Finding[] = [];
const add = (file: string, line: number, level: Level, rule: string, message: string): void => {
  findings.push({ file, line, level, rule, message });
};

// The Files API caps at 3000 files. Key truncation on the changed_files count, not total != list length
// (the count can diverge on binary/rename accounting without truncation). If the count fetch throws we
// can't confirm completeness, but the list reveals it: below the cap it's complete (note); at/above it
// truncation is possible and unconfirmable, so fail closed (error).
let changedFiles: number | undefined;
try {
  changedFiles = Number(
    execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}`, '--jq', '.changed_files'], { encoding: 'utf8' }).trim(),
  );
} catch {
  changedFiles = undefined;
}
if (changedFiles === undefined) {
  const atCap = files.length >= 3000;
  add(
    '',
    1,
    atCap ? 'error' : 'note',
    'scan/count-unavailable',
    atCap
      ? 'File count unavailable and the returned list hit the API cap — completeness unverified; review manually.'
      : 'File count unavailable, but the returned list is below the API cap, so the scan is complete.',
  );
} else if (changedFiles > 3000) {
  add(
    '',
    1,
    'error',
    'scan/truncated',
    `PR changed ${changedFiles} files; only ${files.length} scanned (API cap) — review the rest manually.`,
  );
}

// Added lines from a GitHub API patch (hunks only — no +++/--- file headers), with new-file line
// numbers. With no file headers, a '+'-starting content line (e.g. '++i') is a real added line, not a
// header to skip.
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
      newLine++;
    }
  }
  return out;
};

// Exfiltration signal categories. Bare `process.env`/`fetch` are too common in this codebase to flag
// alone, so env-reads are surfaced only when paired with a network call in the same file; named
// secrets and outbound commands are high-signal enough to flag alone.
const rx = {
  // Named secrets and printenv (an unambiguous full-env dump). The bare `env` dump command is NOT
  // matched: on this JS/TS-heavy repo `env |`/`env >` collide with bitwise-OR/comparison (`env | 0`,
  // `env > n`), so it produced error-level false positives; a real `env | curl` still trips outbound.
  secret: /CN_API_KEY|TURBO_TOKEN|DEPLOY_KEY|printenv/,
  // Require an argument (whitespace + a non-`=` token) so these match a command invocation, not a bare
  // identifier (`const nc = ...`) or a substring inside a URL/word (`https://curl.se`, `// use curl`).
  // Allow an optional .exe so Windows invocations (curl.exe/nc.exe) aren't missed.
  outbound: /\b(curl|wget|netcat|scp|nc|Invoke-WebRequest|iwr)(\.exe)?\s+[^=\s]/,
  // process.env/std::env/os.environ/$env: (single vars) plus bulk-env dumps: a PowerShell Env: drive
  // listing (gci/ls/dir/Get-ChildItem Env:) or bash `export -p`.
  envRead: /process\.env\b|std::env|os\.environ|\$env:|(?:gci|ls|dir|Get-ChildItem)\s+env:|export\s+-p/i,
  // Distinctive HTTP-client names so a full-env exfil (env-egress) isn't missed by client choice. The
  // ambiguous common-word libs got/needle/request are deliberately NOT matched — even as bare calls they
  // collide with local helper/test-util names and, paired with the ubiquitous process.env, produced
  // error-level false positives; the named-secret rule and human review remain the backstop for those.
  http: new RegExp(
    [
      '\\b(fetch|axios|undici|superagent|XMLHttpRequest|reqwest|ureq|httpx|aiohttp|urllib|Invoke-RestMethod)\\b',
      '\\brequests\\.(get|post|put|patch|request)\\b',
      '\\bhttps?\\.(request|get)\\b',
      '\\bhttp\\.client\\b',
    ].join('|'),
  ),
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

  // Lockfile: flag non-registry sources — the top supply-chain exfiltration vector. Plain registry
  // entries carry only an integrity hash, so they don't match.
  if (/(^|\/)pnpm-lock\.yaml$/.test(filename)) {
    if (!patch) {
      // Fail closed: with no diff we can't tell whether a non-registry source was added, so error (reds
      // the status) like scan/truncated and scan/count-unavailable, rather than pass an unscannable
      // lockfile.
      add(
        filename,
        1,
        'error',
        'dep/lockfile-changed',
        'Lockfile changed but the diff was too large for the API to return — sources unscanned; review manually.',
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

  // Registry/source redirection configs can point dependency resolution at an attacker source (or
  // re-enable install scripts) at install/build time.
  if (/(^|\/)(\.npmrc|\.yarnrc\.yml|\.yarnrc)$/.test(filename) || /(^|\/)\.cargo\/config(\.toml)?$/.test(filename)) {
    const redirect = added.find(({ content }) =>
      /\b(registry\s*=|_authToken|replace-with|enable-pre-post-scripts|ignore-scripts\s*=\s*false)/i.test(content),
    );
    add(
      filename,
      redirect?.line ?? 1,
      redirect ? 'error' : 'warning',
      'dep/registry-config',
      redirect
        ? 'Registry/source redirection or install-script re-enable in a package/cargo config — inspect closely.'
        : 'Registry/source config (.npmrc/.yarnrc/.cargo) changed — check for redirected resolution.',
    );
  }

  // .pnpmfile.cjs hooks (readPackage / afterAllResolved) run arbitrary Node code during pnpm install.
  if (/(^|\/)\.pnpmfile\.cjs$/.test(filename))
    add(
      filename,
      1,
      'error',
      'lifecycle/pnpmfile',
      '.pnpmfile.cjs added/changed — its hooks run arbitrary code during pnpm install. Inspect it.',
    );

  if (/(^|\/)package\.json$/.test(filename)) {
    for (const { line, content } of added) {
      // Skip a value that's a clean version/dependency spec (e.g. a dep literally named "install":
      // "^0.13.0"), so it isn't taken for a script hook; a command value — even one starting with a
      // digit, like "2; curl | sh" — is not a clean spec and still flags.
      const m = /"(preinstall|install|postinstall|prepare|prepublish)"\s*:\s*"([^"]*)"/.exec(content);
      const v = m?.[2]?.trim() ?? '';
      const isDepSpec =
        /^[\s\d.xX*^~><=|+-]+$/.test(v) || /^(npm|file|link|workspace|git|github|https?):/.test(v) || v === 'latest';
      if (m && !isDepSpec)
        add(
          filename,
          line,
          'error',
          'lifecycle/install-script',
          `Install-time lifecycle script "${m[1]}" added — runs automatically with the runner env. Inspect it.`,
        );
    }
  }

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
      // The path value must NOT end in .rs, so a [[bin]]/[lib] target source path isn't taken for a dep.
      else if (
        /\bgit\s*=\s*["'][^"']*(:\/\/|@|\.git)/.test(content) ||
        /\bpath\s*=\s*["'][^"']*\/[^"']*(?<!\.rs)["']/.test(content)
      )
        add(
          filename,
          line,
          'warning',
          'rust/non-registry-dep',
          'Non-registry Rust dependency (git/path source) added — runs code at build/test time. Review.',
        );
    }
  }

  // Skip docs/text — they aren't executed, and mentioning curl/CN_API_KEY in prose isn't exfiltration.
  const isDoc = /\.(md|markdown|mdx|txt|rst)$/i.test(filename);
  const first = (re: RegExp): AddedLine | undefined =>
    isDoc ? undefined : added.find(({ content }) => re.test(content));
  const sec = first(rx.secret);
  const out = first(rx.outbound);
  const env = first(rx.envRead);
  const http = first(rx.http);
  const enc = first(rx.encode);
  // Error (reds the gate status) for the two direct key-theft shapes: a named secret in added code, and
  // an env read paired with a network call — which can ship the whole env (e.g. JSON.stringify(
  // process.env)) without ever naming the key. Outbound-command alone / encoding stay advisory (too
  // common to error).
  if (sec)
    add(
      filename,
      sec.line,
      'error',
      'secret/named',
      'A named secret or full-env dump (CN_API_KEY/TURBO_TOKEN/DEPLOY_KEY/printenv) appears in an added line.',
    );
  if (out) add(filename, out.line, 'warning', 'net/outbound-command', 'Outbound network command in an added line.');
  if (env && (out || http))
    add(
      filename,
      env.line,
      'error',
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
  // flag it so an oversized package.json/Cargo.toml/script isn't a blind spot. additions !== 0 skips a
  // pure rename (no patch, additions:0), which added nothing to scan.
  if (
    !patch &&
    additions !== 0 &&
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

  // A present-but-truncated patch (GitHub caps very large patches) leaves the file only partially
  // scanned — flag the blind spot.
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

// Rule metadata so the Security tab shows a name + description, not a bare id (the per-result message
// carries the specifics). Only rules that actually fired are declared in the SARIF run.
const DOC_URI = 'https://github.com/webdriverio/desktop-mobile/blob/main/docs/security/crabnebula-fork-verification.md';
const RULE_META: Record<string, { name: string; description: string }> = {
  'ci/workflow-file': { name: 'Workflow/action file changed', description: 'Changed CI workflow or action file.' },
  'dep/lockfile-changed': { name: 'Lockfile changed', description: 'pnpm-lock.yaml source review.' },
  'dep/registry-config': { name: 'Registry/source config', description: 'Can redirect dependency resolution.' },
  'lifecycle/install-script': { name: 'Install lifecycle script', description: 'Auto-running package.json hook.' },
  'lifecycle/pnpmfile': { name: 'pnpm install hook', description: '.pnpmfile.cjs runs code during install.' },
  'rust/build-script': { name: 'Rust build script', description: 'build.rs runs at compile time.' },
  'rust/build-deps': { name: 'Cargo build-dependencies', description: 'Runs code at build time.' },
  'rust/non-registry-dep': { name: 'Non-registry Rust dep', description: 'git/path Cargo source runs code.' },
  'secret/named': { name: 'Named secret / env dump', description: 'References a CI secret or dumps the env.' },
  'net/outbound-command': { name: 'Outbound network command', description: 'curl/wget/etc. in an added line.' },
  'exfil/env-egress': { name: 'Env read + network', description: 'Possible exfiltration shape.' },
  'obfuscation/encode': { name: 'Encoding near secret', description: 'Can hide exfiltrated data.' },
  'scan/truncated': { name: 'Scan truncated', description: 'PR exceeds the Files API cap.' },
  'scan/count-unavailable': { name: 'Completeness unverified', description: 'Could not confirm scan completeness.' },
  'scan/unscanned': { name: 'File not scanned', description: 'Too large for the API to return a diff.' },
  'scan/partial-diff': { name: 'Partial diff', description: 'Some added lines were not scanned.' },
};

const sarif = {
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'fork-risk-scan',
          informationUri: DOC_URI,
          rules: [...new Set(findings.map((f) => f.rule))].map((id) => ({
            id,
            name: RULE_META[id]?.name ?? id,
            shortDescription: { text: RULE_META[id]?.description ?? id },
            helpUri: DOC_URI,
          })),
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
          // Clamp to >=1: SARIF 2.1.0 rejects startLine 0, and `?? 1` on the source line only guards
          // null/undefined, not a computed 0.
          result.locations = [
            { physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: Math.max(1, f.line) } } },
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
