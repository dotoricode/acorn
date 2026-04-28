process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctor, renderDoctor } from '../src/commands/doctor.ts';
import type { DetectEnv } from '../src/core/provider-detect.ts';
import type { GitRunner } from '../src/core/vendors.ts';
import { vendorsRoot } from '../src/core/env.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_DRIFT = 'd'.repeat(40);

function v3Lock(): string {
  return JSON.stringify({
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      hooks:       { providers: ['gstack', 'claudekit'] },
      planning:    { providers: ['superpowers', 'gsd'] },
      tdd:         { providers: ['claudekit'] },
      review:      { providers: ['superpowers'] },
      qa_headless: { providers: ['gsd'] },
    },
    providers: {
      gstack:      { install_strategy: 'git-clone', repo: 'garrytan/gstack',    commit: SHA_A, verified_at: '2026-01-01' },
      superpowers: { install_strategy: 'git-clone', repo: 'obra/superpowers',   commit: SHA_B, verified_at: '2026-01-01' },
      gsd:         { install_strategy: 'npx',       install_cmd: 'npx gsd',                    verified_at: '2026-01-01' },
      claudekit:   { install_strategy: 'npx',       install_cmd: 'npx claudekit',               verified_at: '2026-01-01' },
    },
    guard: { mode: 'block', patterns: 'strict' },
  });
}

function v2Lock(): string {
  return JSON.stringify({
    schema_version: 2,
    acorn_version: '0.8.0',
    tools: {
      omc:    { repo: 'test/omc',    commit: SHA_A, verified_at: '2026-01-01' },
      gstack: { repo: 'test/gstack', commit: SHA_B, verified_at: '2026-01-01' },
      ecc:    { repo: 'test/ecc',    commit: SHA_A, verified_at: '2026-01-01' },
    },
    guard: { mode: 'block', patterns: 'strict' },
  });
}

interface WS {
  dir: string;
  harnessRoot: string;
  claudeRoot: string;
  lockPath: string;
  settingsPath: string;
  cleanup: () => void;
}

function makeWS(lockContent: string): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-doctor-v3-'));
  const harnessRoot = join(dir, 'harness');
  const claudeRoot = join(dir, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const lockPath = join(harnessRoot, 'harness.lock');
  const settingsPath = join(claudeRoot, 'settings.json');
  writeFileSync(lockPath, lockContent, 'utf8');
  return {
    dir,
    harnessRoot,
    claudeRoot,
    lockPath,
    settingsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function fakeDetect(installed: string[], harnessRoot: string): DetectEnv {
  return {
    harnessRoot,
    dirExists: (p: string) => installed.some((name) => p.endsWith(name)),
    commandExists: (cmd: string) => installed.includes(cmd),
  };
}

function noopGit(): GitRunner {
  return {
    clone() { throw new Error('clone not expected'); },
    checkout() { throw new Error('checkout not expected'); },
    revParse() { throw new Error('revParse not expected'); },
    isGitRepo() { return false; },
    isDirty() { return false; },
  };
}

function gitWithHeads(heads: Record<string, string>): GitRunner {
  return {
    clone() { throw new Error('clone not expected'); },
    checkout() { throw new Error('checkout not expected'); },
    revParse(dir) {
      const h = heads[dir];
      if (h === undefined) throw new Error(`no head for ${dir}`);
      return h;
    },
    isGitRepo() { return true; },
    isDirty() { return false; },
  };
}

// ── v3: all providers missing → warnings / critical ──────────────────────────

test('v3 all providers missing: hooks → critical, others → warning', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    const capIssues = r.issues.filter((i) => i.area === 'capability');
    assert.ok(capIssues.length >= 5, `expected ≥5 capability issues, got ${capIssues.length}`);

    const hooksIssue = capIssues.find((i) => i.subject === 'hooks');
    assert.ok(hooksIssue, 'hooks issue expected');
    assert.equal(hooksIssue?.severity, 'critical');

    const qaIssue = capIssues.find((i) => i.subject === 'qa_headless');
    assert.ok(qaIssue, 'qa_headless issue expected');
    assert.equal(qaIssue?.severity, 'warning');

    const planningIssue = capIssues.find((i) => i.subject === 'planning');
    assert.ok(planningIssue, 'planning issue expected');
    assert.equal(planningIssue?.severity, 'warning');
  } finally {
    ws.cleanup();
  }
});

// ── v3: hooks provider missing → critical ────────────────────────────────────

test('v3 hooks: all providers missing → critical severity', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    const hooksIssue = r.issues.find((i) => i.area === 'capability' && i.subject === 'hooks');
    assert.ok(hooksIssue, 'hooks capability issue must exist');
    assert.equal(hooksIssue?.severity, 'critical');
    assert.ok(hooksIssue?.message.includes('hooks'), 'message mentions hooks');
    assert.ok(hooksIssue?.hint.includes('acorn install'), 'hint mentions acorn install');
  } finally {
    ws.cleanup();
  }
});

// ── v3: qa_headless specific warning ─────────────────────────────────────────

test('v3 qa_headless: no provider installed → warning (not critical)', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    const qaIssue = r.issues.find((i) => i.area === 'capability' && i.subject === 'qa_headless');
    assert.ok(qaIssue, 'qa_headless issue must exist when provider missing');
    assert.equal(qaIssue?.severity, 'warning');
    assert.notEqual(qaIssue?.severity, 'critical');
  } finally {
    ws.cleanup();
  }
});

// ── v3: one provider installed, others missing → info ────────────────────────

test('v3 hooks: gstack installed, claudekit missing → info issue', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: gitWithHeads({}),
      detectEnv: fakeDetect(['gstack'], ws.harnessRoot),
    });

    const hooksIssue = r.issues.find((i) => i.area === 'capability' && i.subject === 'hooks');
    if (hooksIssue) {
      assert.equal(hooksIssue.severity, 'info', 'partial install → info not critical/warning');
    }
    // anyInstalled=true means no critical/warning for hooks
    const critical = r.issues.filter(
      (i) => i.area === 'capability' && i.subject === 'hooks' && i.severity === 'critical',
    );
    assert.equal(critical.length, 0, 'no critical hooks issue when gstack installed');
  } finally {
    ws.cleanup();
  }
});

// ── v3: all providers installed → no capability issues ───────────────────────

test('v3 all providers installed → no capability issues', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    mkdirSync(join(vRoot, 'superpowers'), { recursive: true });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['gstack', 'superpowers', 'gsd', 'claudekit'], ws.harnessRoot),
    });

    const capIssues = r.issues.filter((i) => i.area === 'capability');
    assert.equal(capIssues.length, 0, 'no capability issues when all installed');
  } finally {
    ws.cleanup();
  }
});

// ── v3: git-clone SHA mismatch → vendor warning ──────────────────────────────

test('v3 gstack SHA mismatch → vendor warning', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    const gstackPath = join(vRoot, 'gstack');

    const git = gitWithHeads({ [gstackPath]: SHA_DRIFT });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
      detectEnv: fakeDetect(['gstack'], ws.harnessRoot),
    });

    const mismatch = r.issues.find(
      (i) => i.area === 'vendor' && i.subject === 'gstack',
    );
    assert.ok(mismatch, 'gstack SHA mismatch issue expected');
    assert.equal(mismatch?.severity, 'warning');
    assert.ok(mismatch?.message.includes('gstack'), 'message mentions gstack');
  } finally {
    ws.cleanup();
  }
});

test('v3 superpowers SHA mismatch → vendor warning', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'superpowers'), { recursive: true });
    const spPath = join(vRoot, 'superpowers');

    const git = gitWithHeads({ [spPath]: SHA_DRIFT });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
      detectEnv: fakeDetect(['superpowers'], ws.harnessRoot),
    });

    const mismatch = r.issues.find(
      (i) => i.area === 'vendor' && i.subject === 'superpowers',
    );
    assert.ok(mismatch, 'superpowers SHA mismatch issue expected');
    assert.equal(mismatch?.severity, 'warning');
  } finally {
    ws.cleanup();
  }
});

test('v3 npx provider: no SHA check (no vendor dir → no mismatch issue)', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['gsd', 'claudekit'], ws.harnessRoot),
    });

    const mismatch = r.issues.filter(
      (i) => i.area === 'vendor' && (i.subject === 'gsd' || i.subject === 'claudekit'),
    );
    assert.equal(mismatch.length, 0, 'npx providers should not generate SHA mismatch issues');
  } finally {
    ws.cleanup();
  }
});

test('v3 SHA match → no vendor mismatch issue', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    const gstackPath = join(vRoot, 'gstack');

    const git = gitWithHeads({ [gstackPath]: SHA_A }); // SHA_A matches lock

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
      detectEnv: fakeDetect(['gstack'], ws.harnessRoot),
    });

    const mismatch = r.issues.filter(
      (i) => i.area === 'vendor' && i.subject === 'gstack',
    );
    assert.equal(mismatch.length, 0, 'SHA match → no vendor issue');
  } finally {
    ws.cleanup();
  }
});

// ── v3: capability with no providers configured ──────────────────────────────

test('v3 capability with empty providers → warning (no provider configured)', () => {
  const lockWithEmpty = JSON.stringify({
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      hooks: { providers: [] },
    },
    providers: {},
    guard: { mode: 'block', patterns: 'strict' },
  });

  const ws = makeWS(lockWithEmpty);
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    const capIssue = r.issues.find((i) => i.area === 'capability' && i.subject === 'hooks');
    assert.ok(capIssue, 'empty providers → capability issue');
    assert.equal(capIssue?.severity, 'warning');
    assert.ok(capIssue?.message.includes('제공자가 설정되지 않음'), 'message mentions unconfigured providers');
  } finally {
    ws.cleanup();
  }
});

// ── v3: ok summary when all installed ────────────────────────────────────────

test('v3 all installed → summary has no critical capability issues', () => {
  const ws = makeWS(v3Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    mkdirSync(join(vRoot, 'superpowers'), { recursive: true });
    const gstackPath = join(vRoot, 'gstack');
    const spPath = join(vRoot, 'superpowers');

    const git = gitWithHeads({ [gstackPath]: SHA_A, [spPath]: SHA_B });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
      detectEnv: fakeDetect(['gstack', 'superpowers', 'gsd', 'claudekit'], ws.harnessRoot),
    });

    const critCap = r.issues.filter((i) => i.area === 'capability' && i.severity === 'critical');
    assert.equal(critCap.length, 0, 'no critical capability issues when all installed+SHA match');
  } finally {
    ws.cleanup();
  }
});

// ── v3: report structure ──────────────────────────────────────────────────────

test('v3 runDoctor returns DoctorReport with v3 status section', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    assert.ok(r.status.v3, 'v3 section present in status');
    assert.equal(r.status.acornVersion, '0.9.0');
    assert.ok(Array.isArray(r.issues));
    assert.ok(typeof r.summary.critical === 'number');
  } finally {
    ws.cleanup();
  }
});

test('v3 tools all not_applicable → no vendor issues from tool loop', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    // v3 tools are all not_applicable — the tool loop skips them.
    // Any vendor issues come only from v3ProviderMismatchIssues, not toolIssues.
    const toolLoopIssues = r.issues.filter(
      (i) => i.area === 'vendor' && (i.message.includes('omc') || i.message.includes('ecc')),
    );
    assert.equal(toolLoopIssues.length, 0, 'no omc/ecc vendor issues in v3 mode');
  } finally {
    ws.cleanup();
  }
});

// ── v2 legacy path regression ─────────────────────────────────────────────────

test('v2 lock: no v3 section, tool issues reported normally', () => {
  const ws = makeWS(v2Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'omc'), { recursive: true });
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    mkdirSync(join(vRoot, 'ecc'), { recursive: true });
    const omcPath = join(vRoot, 'omc');
    const gstackPath = join(vRoot, 'gstack');
    const eccPath = join(vRoot, 'ecc');

    const git = gitWithHeads({
      [omcPath]:    SHA_A,
      [gstackPath]: SHA_B,
      [eccPath]:    SHA_A,
    });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
    });

    assert.equal(r.status.v3, undefined, 'v2 lock has no v3 section');
    const capIssues = r.issues.filter((i) => i.area === 'capability');
    assert.equal(capIssues.length, 0, 'no capability issues for v2 lock');
  } finally {
    ws.cleanup();
  }
});

test('v2 lock: missing vendor → critical issue via tool loop', () => {
  const ws = makeWS(v2Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
    });

    assert.equal(r.status.v3, undefined);
    const vendorIssues = r.issues.filter((i) => i.area === 'vendor' && i.severity === 'critical');
    assert.ok(vendorIssues.length >= 1, 'v2 missing vendors → critical issues');
  } finally {
    ws.cleanup();
  }
});

test('v2 lock: SHA drift → warning via tool loop', () => {
  const ws = makeWS(v2Lock());
  try {
    const vRoot = vendorsRoot(ws.harnessRoot);
    mkdirSync(join(vRoot, 'omc'), { recursive: true });
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    mkdirSync(join(vRoot, 'ecc'), { recursive: true });
    const omcPath = join(vRoot, 'omc');
    const gstackPath = join(vRoot, 'gstack');
    const eccPath = join(vRoot, 'ecc');

    // omc drifts
    const git = gitWithHeads({
      [omcPath]:    SHA_DRIFT,
      [gstackPath]: SHA_B,
      [eccPath]:    SHA_A,
    });

    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git,
    });

    const driftIssue = r.issues.find(
      (i) => i.area === 'vendor' && i.subject === 'omc' && i.severity === 'warning',
    );
    assert.ok(driftIssue, 'omc drift → vendor warning');
    assert.equal(r.status.v3, undefined, 'v2 mode: no v3 section');
  } finally {
    ws.cleanup();
  }
});

// ── renderDoctor: v3 capability issues rendered ───────────────────────────────

test('renderDoctor output mentions capability area for v3 issues', () => {
  const ws = makeWS(v3Lock());
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect([], ws.harnessRoot),
    });

    const rendered = renderDoctor(r);
    assert.ok(rendered.includes('capability'), 'rendered output mentions capability area');
    assert.ok(rendered.includes('hooks'), 'rendered output mentions hooks');
  } finally {
    ws.cleanup();
  }
});

// v0.9.3: npm version drift detection
function v3LockWithNpmVersion(version: string): string {
  return JSON.stringify({
    schema_version: 3,
    acorn_version: '0.9.3',
    capabilities: { hooks: { providers: ['claudekit'] } },
    providers: {
      claudekit: {
        install_strategy: 'npx',
        install_cmd: 'npx claudekit@latest',
        version,
        verified_at: '2026-04-28',
      },
    },
    guard: { mode: 'block', patterns: 'strict' },
  });
}

test('v0.9.3 npm version drift: lock 와 latest 일치 → no version issue', () => {
  const ws = makeWS(v3LockWithNpmVersion('1.2.3'));
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['claudekit'], ws.harnessRoot),
      npm: { latestVersion: () => '1.2.3' },
    });
    const versionIssues = r.issues.filter(
      (i) => i.subject === 'claudekit' && /버전 drift/.test(i.message),
    );
    assert.equal(versionIssues.length, 0, '일치할 때 version issue 가 없어야 함');
  } finally {
    ws.cleanup();
  }
});

test('v0.9.3 npm version drift: lock 와 latest 다름 → info issue + 양쪽 표시', () => {
  const ws = makeWS(v3LockWithNpmVersion('1.2.3'));
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['claudekit'], ws.harnessRoot),
      npm: { latestVersion: () => '1.5.0' },
    });
    const versionIssue = r.issues.find(
      (i) => i.subject === 'claudekit' && /버전 drift/.test(i.message),
    );
    assert.ok(versionIssue, 'drift 시 issue 가 있어야 함');
    assert.equal(versionIssue?.severity, 'info');
    assert.ok(/1\.2\.3/.test(versionIssue?.message ?? ''));
    assert.ok(/1\.5\.0/.test(versionIssue?.message ?? ''));
  } finally {
    ws.cleanup();
  }
});

test('v0.9.3 npm version drift: latest=null (네트워크 실패) → silent', () => {
  const ws = makeWS(v3LockWithNpmVersion('1.2.3'));
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['claudekit'], ws.harnessRoot),
      npm: { latestVersion: () => null },
    });
    const versionIssues = r.issues.filter(
      (i) => i.subject === 'claudekit' && /버전 drift/.test(i.message),
    );
    assert.equal(versionIssues.length, 0, 'latest=null 일 때 silent 여야 함 (graceful skip)');
  } finally {
    ws.cleanup();
  }
});

test('v0.9.3 npm version drift: --skip-npm-version-check 등가 옵션 → 비교 자체 스킵', () => {
  const ws = makeWS(v3LockWithNpmVersion('1.2.3'));
  let called = 0;
  try {
    const r = runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['claudekit'], ws.harnessRoot),
      npm: { latestVersion: () => { called++; return '9.9.9'; } },
      skipNpmVersionCheck: true,
    });
    assert.equal(called, 0, 'skipNpmVersionCheck=true 일 때 npm runner 호출 없음');
    const versionIssues = r.issues.filter((i) => /버전 drift/.test(i.message));
    assert.equal(versionIssues.length, 0);
  } finally {
    ws.cleanup();
  }
});

test('v0.9.3 npm version drift: lock 에 version 없으면 비교 스킵', () => {
  // 기존 v3Lock() — version 필드 없음
  const ws = makeWS(v3Lock());
  let called = 0;
  try {
    runDoctor({
      harnessRoot: ws.harnessRoot,
      claudeRoot: ws.claudeRoot,
      lockPath: ws.lockPath,
      settingsPath: ws.settingsPath,
      git: noopGit(),
      detectEnv: fakeDetect(['claudekit', 'gsd'], ws.harnessRoot),
      npm: { latestVersion: () => { called++; return '9.9.9'; } },
    });
    assert.equal(called, 0, 'version 없으면 npm runner 호출 안 함');
  } finally {
    ws.cleanup();
  }
});
