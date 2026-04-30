// v0.9.6+: lock-migrate (순수 매핑) + migrate command (디스크 + tx).
// allowlist bypass: 가짜 repo 사용.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateV2toV3,
  renderMigrationPlan,
  MigrateError,
} from '../src/core/lock-migrate.ts';
import { runMigrate, renderMigrateAction } from '../src/commands/migrate.ts';
import {
  parseLockV3,
  type HarnessLock,
} from '../src/core/lock.ts';

interface WS {
  dir: string;
  harnessRoot: string;
  lockPath: string;
  cleanup: () => void;
}

function makeWS(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-migrate-'));
  const harnessRoot = join(dir, 'harness');
  mkdirSync(harnessRoot, { recursive: true });
  return {
    dir,
    harnessRoot,
    lockPath: join(harnessRoot, 'harness.lock'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const SHA_OMC = 'a'.repeat(40);
const SHA_GS = 'b'.repeat(40);
const SHA_ECC = 'c'.repeat(40);
const SHA_SP = 'd'.repeat(40);
const SHA_CM = 'e'.repeat(40);

const V2_BASE: HarnessLock = {
  schema_version: 2,
  acorn_version: '0.8.5',
  tools: {
    omc: { repo: 'a/omc', commit: SHA_OMC, verified_at: '2026-01-01' },
    gstack: { repo: 'a/gstack', commit: SHA_GS, verified_at: '2026-01-02' },
    ecc: { repo: 'a/ecc', commit: SHA_ECC, verified_at: '2026-01-03' },
  },
  optional_tools: {},
  guard: { mode: 'block', patterns: 'strict' },
};

function v2WithOptional(): HarnessLock {
  return {
    ...V2_BASE,
    optional_tools: {
      superpowers: { repo: 'a/sp', commit: SHA_SP, verified_at: '2026-01-04' },
      'claude-mem': { repo: 'a/cm', commit: SHA_CM, verified_at: '2026-01-05' },
    },
  };
}

// ── pure migrator ───────────────────────────────────────────────────────────

test('migrateV2toV3: gstack 보존 + omc/ecc drop', () => {
  const r = migrateV2toV3(V2_BASE);
  assert.equal(r.v3Lock.schema_version, 3);
  assert.deepEqual(Object.keys(r.v3Lock.providers), ['gstack']);
  assert.equal(r.preserved.length, 1);
  assert.equal(r.preserved[0]?.tool, 'gstack');
  assert.equal(r.drops.length, 2);
  const dropNames = r.drops.map((d) => d.tool).sort();
  assert.deepEqual(dropNames, ['ecc', 'omc']);
  assert.equal(r.warnings.length >= 2, true);
});

test('migrateV2toV3: optional superpowers 보존, claude-mem drop', () => {
  const r = migrateV2toV3(v2WithOptional());
  const providerNames = Object.keys(r.v3Lock.providers).sort();
  assert.deepEqual(providerNames, ['gstack', 'superpowers']);
  const drops = r.drops.map((d) => d.tool).sort();
  assert.deepEqual(drops, ['claude-mem', 'ecc', 'omc']);
});

test('migrateV2toV3: gstack provider 의 commit/repo/verified_at 보존', () => {
  const r = migrateV2toV3(V2_BASE);
  const gstack = r.v3Lock.providers['gstack'];
  assert.ok(gstack && gstack.install_strategy === 'git-clone');
  if (gstack.install_strategy === 'git-clone') {
    assert.equal(gstack.repo, 'a/gstack');
    assert.equal(gstack.commit, SHA_GS);
    assert.equal(gstack.verified_at, '2026-01-02');
  }
});

test('migrateV2toV3: gstack 의 primary capability (hooks) 가 capabilities 에 등록', () => {
  const r = migrateV2toV3(V2_BASE);
  const hooks = r.v3Lock.capabilities.hooks;
  assert.ok(hooks);
  assert.deepEqual([...hooks.providers], ['gstack']);
  // memory 는 secondary 라서 등록 안 됨.
  assert.equal(r.v3Lock.capabilities.memory, undefined);
});

test('migrateV2toV3: superpowers 의 primary capability (planning) 등록', () => {
  const r = migrateV2toV3(v2WithOptional());
  assert.deepEqual([...(r.v3Lock.capabilities.planning?.providers ?? [])], ['superpowers']);
});

test('migrateV2toV3: guard mode/patterns 보존', () => {
  const r = migrateV2toV3({
    ...V2_BASE,
    guard: { mode: 'warn', patterns: 'minimal' },
  });
  assert.deepEqual(r.v3Lock.guard, { mode: 'warn', patterns: 'minimal' });
});

test('migrateV2toV3: acornVersion override', () => {
  const r = migrateV2toV3(V2_BASE, { acornVersion: '0.9.6' });
  assert.equal(r.v3Lock.acorn_version, '0.9.6');
});

test('migrateV2toV3: 결과 v3 lock 은 parseLockV3 검증 통과', () => {
  const r = migrateV2toV3(v2WithOptional(), { acornVersion: '0.9.6' });
  const json = JSON.stringify(r.v3Lock, null, 2);
  // 파서가 throw 하지 않아야 함.
  const parsed = parseLockV3(json);
  assert.equal(parsed.schema_version, 3);
});

test('renderMigrationPlan: preserved/dropped/warnings 모두 포함', () => {
  const r = migrateV2toV3(v2WithOptional());
  const out = renderMigrationPlan(r);
  assert.ok(out.includes('preserved'));
  assert.ok(out.includes('gstack'));
  assert.ok(out.includes('superpowers'));
  assert.ok(out.includes('dropped'));
  assert.ok(out.includes('omc'));
  assert.ok(out.includes('ecc'));
  assert.ok(out.includes('claude-mem'));
  assert.ok(out.includes('warnings'));
  assert.ok(out.includes('block/strict'));
});

// ── runMigrate: dry-run / auto / no-op ───────────────────────────────────────

function writeV2Lock(path: string, lock: HarnessLock): void {
  writeFileSync(path, JSON.stringify(lock, null, 2), 'utf8');
}

test('runMigrate: 기본 (dry-run) → kind=plan, 디스크 변경 없음', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, V2_BASE);
    const before = readFileSync(w.lockPath, 'utf8');
    const a = runMigrate({ harnessRoot: w.harnessRoot, lockPath: w.lockPath });
    assert.equal(a.kind, 'plan');
    const after = readFileSync(w.lockPath, 'utf8');
    assert.equal(before, after, 'dry-run 이 lock 을 건드림');
    // backup / migrations 디렉토리도 안 만들어져야 함.
    assert.equal(existsSync(join(w.harnessRoot, 'backup')), false);
    assert.equal(existsSync(join(w.harnessRoot, 'migrations')), false);
  } finally {
    w.cleanup();
  }
});

test('runMigrate: 이미 v3 → kind=noop', () => {
  const w = makeWS();
  try {
    const v3 = {
      schema_version: 3,
      acorn_version: '0.9.6',
      capabilities: {},
      providers: {},
      guard: { mode: 'block', patterns: 'strict' },
    };
    writeFileSync(w.lockPath, JSON.stringify(v3, null, 2), 'utf8');
    const a = runMigrate({ harnessRoot: w.harnessRoot, lockPath: w.lockPath });
    assert.equal(a.kind, 'noop');
    if (a.kind === 'noop') assert.equal(a.reason, 'already-v3');
  } finally {
    w.cleanup();
  }
});

test('runMigrate: --auto --yes → kind=migrated + backup + log', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, v2WithOptional());
    const a = runMigrate({
      harnessRoot: w.harnessRoot,
      lockPath: w.lockPath,
      auto: true,
      yes: true,
    });
    assert.equal(a.kind, 'migrated');
    if (a.kind !== 'migrated') return;

    // lock 이 v3 으로 교체됨
    const newLock = JSON.parse(readFileSync(w.lockPath, 'utf8'));
    assert.equal(newLock.schema_version, 3);
    assert.deepEqual(Object.keys(newLock.providers).sort(), ['gstack', 'superpowers']);

    // backup 존재
    assert.ok(existsSync(a.backupPath), `backup 누락: ${a.backupPath}`);
    const backupContent = JSON.parse(readFileSync(a.backupPath, 'utf8'));
    assert.equal(backupContent.schema_version, 2);

    // log 존재 + JSON 파싱 가능
    assert.ok(existsSync(a.logPath), `log 누락: ${a.logPath}`);
    const log = JSON.parse(readFileSync(a.logPath, 'utf8'));
    assert.equal(log.v2.schema_version, 2);
    assert.equal(log.v3.acorn_version, '0.8.5'); // v2 의 acorn_version 보존
    assert.deepEqual(log.preserved.map((p: { tool: string }) => p.tool).sort(), [
      'gstack',
      'superpowers',
    ]);
  } finally {
    w.cleanup();
  }
});

test('runMigrate: --auto without --yes (non-TTY, no confirm) → IO 에러', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, V2_BASE);
    assert.throws(
      () =>
        runMigrate({
          harnessRoot: w.harnessRoot,
          lockPath: w.lockPath,
          auto: true,
        }),
      (e: unknown) => e instanceof MigrateError && e.code === 'IO',
    );
    // 디스크 변경 없음.
    const lock = JSON.parse(readFileSync(w.lockPath, 'utf8'));
    assert.equal(lock.schema_version, 2);
  } finally {
    w.cleanup();
  }
});

test('runMigrate: --auto + confirm 거절 → kind=cancelled, 디스크 변경 없음', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, V2_BASE);
    const a = runMigrate({
      harnessRoot: w.harnessRoot,
      lockPath: w.lockPath,
      auto: true,
      confirm: () => false,
    });
    assert.equal(a.kind, 'cancelled');
    const lock = JSON.parse(readFileSync(w.lockPath, 'utf8'));
    assert.equal(lock.schema_version, 2);
  } finally {
    w.cleanup();
  }
});

test('runMigrate: lockPath 없음 → IO 에러', () => {
  const w = makeWS();
  try {
    assert.throws(
      () =>
        runMigrate({
          harnessRoot: w.harnessRoot,
          lockPath: w.lockPath, // 존재하지 않는 경로
        }),
      (e: unknown) => e instanceof MigrateError && e.code === 'IO',
    );
  } finally {
    w.cleanup();
  }
});

test('runMigrate: 손상 JSON → LockError (PARSE) — migrate 가 아니라 lock 모듈에서 throw', () => {
  const w = makeWS();
  try {
    writeFileSync(w.lockPath, '{not json', 'utf8');
    assert.throws(
      () => runMigrate({ harnessRoot: w.harnessRoot, lockPath: w.lockPath }),
      (e: unknown) => {
        // LockError 는 namespace=lock + code=PARSE
        return (
          typeof e === 'object' &&
          e !== null &&
          'code' in e &&
          (e as { code: unknown }).code === 'PARSE'
        );
      },
    );
  } finally {
    w.cleanup();
  }
});

test('runMigrate: --auto --yes 후 두 번째 호출 → noop (already-v3)', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, V2_BASE);
    runMigrate({
      harnessRoot: w.harnessRoot,
      lockPath: w.lockPath,
      auto: true,
      yes: true,
    });
    const second = runMigrate({
      harnessRoot: w.harnessRoot,
      lockPath: w.lockPath,
    });
    assert.equal(second.kind, 'noop');
  } finally {
    w.cleanup();
  }
});

test('renderMigrateAction: plan/migrated/cancelled/noop 출력', () => {
  // plan
  const r = migrateV2toV3(V2_BASE);
  const plan = renderMigrateAction({
    kind: 'plan',
    result: r,
    lockPath: '/tmp/lock',
  });
  assert.ok(plan.includes('plan v2 → v3'));
  assert.ok(plan.includes('--auto'));
  // migrated
  const mig = renderMigrateAction({
    kind: 'migrated',
    result: r,
    lockPath: '/tmp/lock',
    backupPath: '/tmp/bak',
    logPath: '/tmp/log',
  });
  assert.ok(mig.includes('✅ migrate 완료'));
  assert.ok(mig.includes('/tmp/bak'));
  // cancelled
  const c = renderMigrateAction({ kind: 'cancelled', reason: 'user-rejected' });
  assert.ok(c.includes('취소됨'));
  // noop
  const n = renderMigrateAction({
    kind: 'noop',
    reason: 'already-v3',
    lockPath: '/tmp/lock',
  });
  assert.ok(n.includes('already v3'));
});

test('runMigrate: --auto --yes 가 backup 디렉토리 ts 가 분 단위로 정렬됨', () => {
  const w = makeWS();
  try {
    writeV2Lock(w.lockPath, V2_BASE);
    const a = runMigrate({
      harnessRoot: w.harnessRoot,
      lockPath: w.lockPath,
      auto: true,
      yes: true,
    });
    assert.equal(a.kind, 'migrated');
    if (a.kind !== 'migrated') return;
    const backupRoot = join(w.harnessRoot, 'backup');
    const tsDirs = readdirSync(backupRoot);
    assert.equal(tsDirs.length, 1);
    // backupDirTs 는 ISO 에서 ":" "." → "-" 치환된 형태.
    assert.match(tsDirs[0] ?? '', /^\d{4}-\d{2}-\d{2}T/);
    // backup/<ts>/migrate/<basename>.v2.bak 구조 확인.
    const sub = readdirSync(join(backupRoot, tsDirs[0]!));
    assert.deepEqual(sub, ['migrate']);
  } finally {
    w.cleanup();
  }
});
