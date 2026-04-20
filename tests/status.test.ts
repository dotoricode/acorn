// §15 HIGH-2 / ADR-020 (v0.4.0): 가짜 repo 사용 — allowlist bypass.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

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
import {
  collectStatus,
  renderStatus,
  summarize,
} from '../src/commands/status.ts';
import type { GitRunner } from '../src/core/vendors.ts';

const SHA_OMC = 'a'.repeat(40);
const SHA_GSTACK = 'b'.repeat(40);
const SHA_ECC = 'c'.repeat(40);

function makeLockJson(): string {
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
  const dir = mkdtempSync(join(tmpdir(), 'acorn-status-'));
  const harnessRoot = join(dir, 'harness');
  const claudeRoot = join(dir, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const lockPath = join(harnessRoot, 'harness.lock');
  const settingsPath = join(claudeRoot, 'settings.json');
  writeFileSync(lockPath, makeLockJson(), 'utf8');
  return {
    dir,
    harnessRoot,
    claudeRoot,
    lockPath,
    settingsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeGitMock(heads: Record<string, string>): GitRunner {
  return {
    clone() { throw new Error('not used'); },
    checkout() { throw new Error('not used'); },
    revParse(dir) {
      const h = heads[dir];
      if (!h) throw new Error(`no head for ${dir}`);
      return h;
    },
    isGitRepo() { return true; },
    isDirty() { return false; },
  };
}

function setupVendors(
  w: WS,
  commits: Partial<Record<'omc' | 'gstack' | 'ecc', string>>,
): Record<string, string> {
  const heads: Record<string, string> = {};
  for (const [name, sha] of Object.entries(commits)) {
    if (!sha) continue;
    const path = join(w.harnessRoot, 'vendors', name);
    mkdirSync(join(path, '.git'), { recursive: true });
    heads[path] = sha;
  }
  return heads;
}

test('collectStatus: 모든 vendor 일치 + env 없음 → locked + env missing', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, {
      omc: SHA_OMC,
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    assert.equal(r.tools.omc.state, 'locked');
    assert.equal(r.tools.gstack.state, 'locked');
    assert.equal(r.tools.ecc.state, 'locked');
    assert.equal(r.env.every((e) => e.status === 'missing'), true);
    assert.equal(r.gstackSymlink.status, 'absent');
  } finally {
    w.cleanup();
  }
});

test('collectStatus: vendor 디렉토리 없음 → missing', () => {
  const w = makeWorkspace();
  try {
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock({}),
    });
    assert.equal(r.tools.omc.state, 'missing');
    assert.equal(r.tools.omc.actualCommit, null);
  } finally {
    w.cleanup();
  }
});

test('collectStatus: vendor SHA 불일치 → drift', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, {
      omc: 'd'.repeat(40), // 불일치
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    assert.equal(r.tools.omc.state, 'drift');
    assert.equal(r.tools.omc.actualCommit, 'd'.repeat(40));
  } finally {
    w.cleanup();
  }
});

test('collectStatus: settings.json env 일치 → match', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        env: {
          CLAUDE_PLUGIN_ROOT: join(w.harnessRoot, 'vendors'),
          OMC_PLUGIN_ROOT: join(w.harnessRoot, 'vendors', 'omc'),
          ECC_ROOT: join(w.harnessRoot, 'vendors', 'ecc'),
        },
      }),
      'utf8',
    );
    const heads = setupVendors(w, { omc: SHA_OMC, gstack: SHA_GSTACK, ecc: SHA_ECC });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    assert.equal(r.env.every((e) => e.status === 'match'), true);
  } finally {
    w.cleanup();
  }
});

test('collectStatus: gstack 심링크 정확 → correct', () => {
  const w = makeWorkspace();
  try {
    const gstackVendor = join(w.harnessRoot, 'vendors', 'gstack');
    mkdirSync(gstackVendor, { recursive: true });
    mkdirSync(join(w.claudeRoot, 'skills'), { recursive: true });
    symlinkSync(gstackVendor, join(w.claudeRoot, 'skills', 'gstack'), 'dir');

    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock({}),
    });
    assert.equal(r.gstackSymlink.status, 'correct');
  } finally {
    w.cleanup();
  }
});

test('renderStatus: 사람이 읽을 수 있는 박스 출력', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, { omc: SHA_OMC, gstack: SHA_GSTACK, ecc: SHA_ECC });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    const out = renderStatus(r);
    assert.ok(out.includes('acorn v0.1.0'));
    assert.ok(out.includes('omc'));
    assert.ok(out.includes('gstack'));
    assert.ok(out.includes('ecc'));
    assert.ok(out.includes('guard'));
    assert.ok(out.includes('block / strict'));
  } finally {
    w.cleanup();
  }
});

test('summarize: 모든 정상 → ok=true', () => {
  const w = makeWorkspace();
  try {
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
    const gstackVendor = join(w.harnessRoot, 'vendors', 'gstack');
    mkdirSync(gstackVendor, { recursive: true });
    mkdirSync(join(w.claudeRoot, 'skills'), { recursive: true });
    symlinkSync(gstackVendor, join(w.claudeRoot, 'skills', 'gstack'), 'dir');
    // phase.txt 이 없으면 phase.status='missing' → summarize 에서 issue 추가됨
    writeFileSync(join(w.harnessRoot, 'phase.txt'), 'dev\n');
    const heads = setupVendors(w, { omc: SHA_OMC, gstack: SHA_GSTACK, ecc: SHA_ECC });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    const s = summarize(r);
    assert.equal(s.ok, true);
    assert.equal(s.issues.length, 0);
  } finally {
    w.cleanup();
  }
});

// §15 v0.4.1 #5 — runtimeEnv 미지정 시 envRuntime 은 빈 배열 (skip 의미) 이어야 한다.
// 이전 (v0.4.0 까지) 은 `diffEnv(desired, desired)` 로 fake-match 반환했다.
test('collectStatus: runtimeEnv 미지정 → envRuntime=[] (skip 의미, fake-match 금지)', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, { omc: SHA_OMC, gstack: SHA_GSTACK, ecc: SHA_ECC });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
      // runtimeEnv 의도적 미지정
    });
    assert.equal(r.envRuntime.length, 0);
  } finally {
    w.cleanup();
  }
});

test('collectStatus: runtimeEnv 명시 시 envRuntime 은 3키 모두 반환', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, { omc: SHA_OMC, gstack: SHA_GSTACK, ecc: SHA_ECC });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
      runtimeEnv: {}, // 빈 runtime → 전부 missing 이어야 함
    });
    assert.equal(r.envRuntime.length, 3);
    assert.ok(r.envRuntime.every((e) => e.status === 'missing'));
  } finally {
    w.cleanup();
  }
});

test('summarize: drift 하나만 있어도 ok=false + issues 나열', () => {
  const w = makeWorkspace();
  try {
    const heads = setupVendors(w, {
      omc: 'd'.repeat(40),
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectStatus({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git: makeGitMock(heads),
    });
    const s = summarize(r);
    assert.equal(s.ok, false);
    assert.ok(s.issues.some((i) => i.startsWith('omc:')));
  } finally {
    w.cleanup();
  }
});
