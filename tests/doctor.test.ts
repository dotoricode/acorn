import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, renderDoctor, renderDoctorJson } from '../src/commands/doctor.ts';
import type { GitRunner } from '../src/core/vendors.ts';
import { beginTx } from '../src/core/tx.ts';

const SHA_OMC = 'a'.repeat(40);
const SHA_GSTACK = 'b'.repeat(40);
const SHA_ECC = 'c'.repeat(40);

function lockJson(): string {
  return JSON.stringify({
    schema_version: 1,
    acorn_version: '0.1.0',
    tools: {
      omc: { repo: 'org/omc', commit: SHA_OMC, verified_at: '2026-04-15' },
      gstack: { repo: 'org/gstack', commit: SHA_GSTACK, verified_at: '2026-04-15' },
      ecc: { repo: 'org/ecc', commit: SHA_ECC, verified_at: '2026-04-15' },
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

function makeWorkspace(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-doctor-'));
  const harnessRoot = join(dir, 'harness');
  const claudeRoot = join(dir, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const lockPath = join(harnessRoot, 'harness.lock');
  const settingsPath = join(claudeRoot, 'settings.json');
  writeFileSync(lockPath, lockJson(), 'utf8');
  return {
    dir,
    harnessRoot,
    claudeRoot,
    lockPath,
    settingsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function gitMock(
  heads: Record<string, string>,
  dirty: Set<string> = new Set(),
): GitRunner {
  return {
    clone() { throw new Error('unused'); },
    checkout() { throw new Error('unused'); },
    revParse(dir) {
      const h = heads[dir];
      if (!h) throw new Error(`no head ${dir}`);
      return h;
    },
    isGitRepo() { return true; },
    isDirty(dir) { return dirty.has(dir); },
  };
}

function setupHealthy(w: WS): { heads: Record<string, string> } {
  const heads: Record<string, string> = {};
  for (const [name, sha] of Object.entries({
    omc: SHA_OMC,
    gstack: SHA_GSTACK,
    ecc: SHA_ECC,
  })) {
    const p = join(w.harnessRoot, 'vendors', name);
    mkdirSync(join(p, '.git'), { recursive: true });
    writeFileSync(join(p, 'README.md'), 'x');
    heads[p] = sha;
  }
  const gstackVendor = join(w.harnessRoot, 'vendors', 'gstack');
  mkdirSync(join(w.claudeRoot, 'skills'), { recursive: true });
  symlinkSync(gstackVendor, join(w.claudeRoot, 'skills', 'gstack'), 'dir');
  writeFileSync(
    w.settingsPath,
    JSON.stringify({
      env: {
        CLAUDE_PLUGIN_ROOT: join(w.harnessRoot, 'vendors'),
        OMC_PLUGIN_ROOT: join(w.harnessRoot, 'vendors', 'omc'),
        ECC_ROOT: join(w.harnessRoot, 'vendors', 'ecc'),
      },
    }),
  );
  return { heads };
}

test('runDoctor: 정상 상태 → zero-issue, ok=true', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    assert.equal(r.ok, true);
    assert.equal(r.issues.length, 0);
  } finally {
    w.cleanup();
  }
});

test('runDoctor: vendor missing → critical issue + hint', () => {
  const w = makeWorkspace();
  try {
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock({}),
    });
    const vendorIssues = r.issues.filter((i) => i.area === 'vendor');
    assert.equal(vendorIssues.length, 3);
    assert.ok(vendorIssues.every((i) => i.severity === 'critical'));
    assert.ok(vendorIssues[0]?.hint.includes('acorn install'));
    assert.equal(r.ok, false);
  } finally {
    w.cleanup();
  }
});

test('runDoctor: vendor drift → warning', () => {
  const w = makeWorkspace();
  try {
    setupHealthy(w);
    const heads: Record<string, string> = {
      [join(w.harnessRoot, 'vendors', 'omc')]: 'd'.repeat(40),
      [join(w.harnessRoot, 'vendors', 'gstack')]: SHA_GSTACK,
      [join(w.harnessRoot, 'vendors', 'ecc')]: SHA_ECC,
    };
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    const drift = r.issues.find((i) => i.area === 'vendor' && i.subject === 'omc');
    assert.ok(drift);
    assert.equal(drift?.severity, 'warning');
    assert.ok(drift?.message.includes('dddd'));
  } finally {
    w.cleanup();
  }
});

test('runDoctor: vendor dirty (healthy SHA) → warning + dirty hint', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const omcPath = join(w.harnessRoot, 'vendors', 'omc');
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads, new Set([omcPath])),
    });
    const dirty = r.issues.find((i) => i.area === 'vendor' && i.subject === 'omc');
    assert.ok(dirty);
    assert.equal(dirty?.severity, 'warning');
    assert.ok(dirty?.hint.includes('dirty'));
  } finally {
    w.cleanup();
  }
});

test('runDoctor: 심링크 손상 수동 삭제 → 정확 지적 (Done Definition 체크포인트)', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    rmSync(join(w.claudeRoot, 'skills', 'gstack'));
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    const sym = r.issues.find((i) => i.area === 'symlink');
    assert.ok(sym);
    assert.equal(sym?.severity, 'critical');
    assert.ok(sym?.hint.includes('acorn install'));
  } finally {
    w.cleanup();
  }
});

test('runDoctor: tx.log in_progress → critical', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const tx = beginTx(w.harnessRoot);
    tx.phase('vendors');
    // commit 없음

    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    const txIssue = r.issues.find((i) => i.area === 'tx');
    assert.ok(txIssue);
    assert.equal(txIssue?.severity, 'critical');
    assert.ok(txIssue?.hint.includes('--force'));
  } finally {
    w.cleanup();
  }
});

test('renderDoctor: 정상 → "이슈 없음" 라인', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    const out = renderDoctor(r);
    assert.ok(out.includes('이슈 없음'));
  } finally {
    w.cleanup();
  }
});

test('renderDoctor: 이슈 있으면 subject + hint 포함', () => {
  const w = makeWorkspace();
  try {
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock({}),
    });
    const out = renderDoctor(r);
    assert.ok(out.includes('critical'));
    assert.ok(out.includes('omc'));
    assert.ok(out.includes('→'));
  } finally {
    w.cleanup();
  }
});

test('renderDoctorJson: 기계 판독 가능 구조 (Done Definition)', () => {
  const w = makeWorkspace();
  try {
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock({}),
    });
    const raw = renderDoctorJson(r);
    const parsed = JSON.parse(raw) as {
      ok: boolean;
      issues: Array<{ area: string; severity: string; hint: string }>;
      harnessRoot: string;
    };
    assert.equal(parsed.ok, false);
    assert.ok(Array.isArray(parsed.issues));
    assert.ok(parsed.issues.length >= 3);
    assert.ok(parsed.issues.every((i) => typeof i.hint === 'string'));
  } finally {
    w.cleanup();
  }
});

test('runDoctor: warning-only → ok=false, okCritical=true (CI "crit-fail/warn-pass" 패턴)', () => {
  const w = makeWorkspace();
  try {
    setupHealthy(w);
    // omc SHA 만 drift 시킨다 → warning-only 상태
    const heads: Record<string, string> = {
      [join(w.harnessRoot, 'vendors', 'omc')]: 'd'.repeat(40),
      [join(w.harnessRoot, 'vendors', 'gstack')]: SHA_GSTACK,
      [join(w.harnessRoot, 'vendors', 'ecc')]: SHA_ECC,
    };
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    assert.equal(r.summary.critical, 0);
    assert.equal(r.summary.warning, 1);
    assert.equal(r.ok, false);
    assert.equal(r.okCritical, true);
  } finally {
    w.cleanup();
  }
});

test('runDoctor: critical 혼재 → ok=false, okCritical=false, summary 카운트 정확', () => {
  const w = makeWorkspace();
  try {
    // 아무 setup 도 안 함: vendors 전부 missing (critical 3개)
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock({}),
    });
    assert.ok(r.summary.critical >= 3);
    assert.equal(r.ok, false);
    assert.equal(r.okCritical, false);
    assert.equal(
      r.summary.critical + r.summary.warning + r.summary.info,
      r.issues.length,
    );
  } finally {
    w.cleanup();
  }
});

test('runDoctor: 정상 상태 → ok=true, okCritical=true, summary 전부 0', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    assert.equal(r.ok, true);
    assert.equal(r.okCritical, true);
    assert.deepEqual(r.summary, { critical: 0, warning: 0, info: 0 });
  } finally {
    w.cleanup();
  }
});

test('runDoctor: isDirty 실패 → warning issue 노출 (§15 C6 silent-lie 방지)', () => {
  const w = makeWorkspace();
  try {
    const { heads } = setupHealthy(w);
    const omcPath = join(w.harnessRoot, 'vendors', 'omc');
    // isDirty / getDirtyPaths 가 throw 하는 git 러너.
    // 현실 시나리오: git status 가 권한/잠금/손상으로 실패.
    const failingGit: GitRunner = {
      ...gitMock(heads),
      isDirty(dir) {
        if (dir === omcPath) throw new Error('EACCES: git status failed');
        return false;
      },
    };
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: failingGit,
    });
    // 이전 동작: catch 흡수로 issue 0 → .ok=true (silent-lie)
    // 신규 동작: warning 으로 노출 → .ok=false, .okCritical=true
    const omcIssue = r.issues.find(
      (i) => i.area === 'vendor' && i.subject === 'omc',
    );
    assert.ok(omcIssue, 'dirty 감지 실패가 issue 로 노출되어야 함 (C6 regression guard)');
    assert.equal(omcIssue?.severity, 'warning');
    assert.ok(omcIssue?.message.includes('dirty'));
    assert.ok(omcIssue?.message.includes('EACCES'));
    assert.ok(omcIssue?.hint.includes('git -C'));
    assert.equal(r.ok, false);
    assert.equal(r.okCritical, true);
  } finally {
    w.cleanup();
  }
});

test('renderDoctorJson: okCritical / summary 필드 포함 (S9 실증 반영)', () => {
  const w = makeWorkspace();
  try {
    setupHealthy(w);
    const heads: Record<string, string> = {
      [join(w.harnessRoot, 'vendors', 'omc')]: 'd'.repeat(40),
      [join(w.harnessRoot, 'vendors', 'gstack')]: SHA_GSTACK,
      [join(w.harnessRoot, 'vendors', 'ecc')]: SHA_ECC,
    };
    const r = runDoctor({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: gitMock(heads),
    });
    const parsed = JSON.parse(renderDoctorJson(r)) as {
      ok: boolean;
      okCritical: boolean;
      summary: { critical: number; warning: number; info: number };
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.okCritical, true);
    assert.equal(parsed.summary.critical, 0);
    assert.equal(parsed.summary.warning, 1);
    assert.equal(parsed.summary.info, 0);
  } finally {
    w.cleanup();
  }
});
