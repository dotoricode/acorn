import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseLock,
  parseLockV2,
  parseLockV3,
  LockError,
  CAPABILITY_NAMES,
  type HarnessLockV3,
} from '../src/core/lock.ts';

const SHA = '1234567890abcdef1234567890abcdef12345678';

const VALID_V3: HarnessLockV3 = {
  schema_version: 3,
  acorn_version: '0.9.1',
  capabilities: {
    planning: { providers: ['superpowers'] },
    tdd: { providers: ['claudekit'] },
  },
  providers: {
    superpowers: {
      install_strategy: 'git-clone',
      repo: 'obra/superpowers',
      commit: SHA,
      verified_at: '2026-04-22',
    },
    claudekit: {
      install_strategy: 'npx',
      install_cmd: 'npx @carlrannaberg/claudekit@latest',
      verified_at: '2026-04-22',
    },
  },
  guard: { mode: 'block', patterns: 'moderate' },
};

// ── 최소 v3 파싱 성공 ─────────────────────────────────────────────────────────

test('v3: parseLockV3 정상 파싱', () => {
  const lock = parseLockV3(JSON.stringify(VALID_V3));
  assert.equal(lock.schema_version, 3);
  assert.equal(lock.acorn_version, '0.9.1');
  assert.equal(lock.guard.mode, 'block');
  assert.equal(lock.guard.patterns, 'moderate');
});

test('v3: parseLock 이 v3 lock 을 읽음', () => {
  const lock = parseLock(JSON.stringify(VALID_V3));
  assert.equal(lock.schema_version, 3);
});

test('v3: capabilities 모든 허용 이름 수용', () => {
  const all: Record<string, unknown> = {};
  for (const name of CAPABILITY_NAMES) {
    all[name] = { providers: ['p1'] };
  }
  const full = { ...VALID_V3, capabilities: all };
  const lock = parseLockV3(JSON.stringify(full));
  assert.equal(Object.keys(lock.capabilities).length, CAPABILITY_NAMES.length);
});

test('v3: capabilities 빈 객체 수용 (모두 optional)', () => {
  const lock = parseLockV3(JSON.stringify({ ...VALID_V3, capabilities: {} }));
  assert.deepEqual(lock.capabilities, {});
});

test('v3: presets optional — 없으면 undefined', () => {
  const { presets: _omit, ...noPresets } = VALID_V3;
  const lock = parseLockV3(JSON.stringify(noPresets));
  assert.equal(lock.presets, undefined);
});

test('v3: presets 포함 파싱 성공', () => {
  const withPresets = {
    ...VALID_V3,
    presets: {
      prototype: { capabilities: ['planning', 'hooks'] },
      dev: { capabilities: ['planning', 'tdd', 'review', 'hooks'] },
    },
  };
  const lock = parseLockV3(JSON.stringify(withPresets));
  assert.ok(lock.presets);
  assert.deepEqual(lock.presets?.['prototype']?.capabilities, ['planning', 'hooks']);
});

test('v3: git-clone provider — repo/commit 필수', () => {
  const lock = parseLockV3(JSON.stringify(VALID_V3));
  const sp = lock.providers['superpowers'];
  assert.ok(sp.install_strategy === 'git-clone');
  if (sp.install_strategy === 'git-clone') {
    assert.equal(sp.repo, 'obra/superpowers');
    assert.equal(sp.commit.length, 40);
  }
});

test('v3: npm/npx provider — install_cmd 필수', () => {
  const lock = parseLockV3(JSON.stringify(VALID_V3));
  const ck = lock.providers['claudekit'];
  assert.ok(ck.install_strategy === 'npx');
  if (ck.install_strategy === 'npx') {
    assert.equal(ck.install_cmd, 'npx @carlrannaberg/claudekit@latest');
  }
});

// ── invalid capability 거부 ───────────────────────────────────────────────────

test('v3: 허용되지 않은 capability 이름 → SCHEMA', () => {
  const bad = { ...VALID_V3, capabilities: { unknown_cap: { providers: ['p'] } } };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError &&
      e.code === 'SCHEMA' &&
      /unknown_cap/.test(e.message),
  );
});

test('v3: capability.providers 가 string[] 아님 → SCHEMA', () => {
  const bad = { ...VALID_V3, capabilities: { planning: { providers: 'not-array' } } };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError && e.code === 'SCHEMA' && /string\[\]/.test(e.message),
  );
});

test('v3: capability 값이 object 아님 → SCHEMA', () => {
  const bad = { ...VALID_V3, capabilities: { planning: 'string-instead-of-object' } };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA',
  );
});

// ── invalid provider shape 거부 ───────────────────────────────────────────────

test('v3: 알 수 없는 install_strategy → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    providers: {
      bad_provider: {
        install_strategy: 'docker',
        verified_at: '2026-04-22',
      },
    },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError &&
      e.code === 'SCHEMA' &&
      /install_strategy/.test(e.message),
  );
});

test('v3: git-clone provider 에서 commit 형식 위반 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    providers: {
      sp: {
        install_strategy: 'git-clone',
        repo: 'obra/superpowers',
        commit: 'short',
        verified_at: '2026-04-22',
      },
    },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError && e.code === 'SCHEMA' && /SHA1/.test(e.message),
  );
});

test('v3: git-clone provider 에서 repo 형식 위반 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    providers: {
      sp: {
        install_strategy: 'git-clone',
        repo: 'no-slash',
        commit: SHA,
        verified_at: '2026-04-22',
      },
    },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA',
  );
});

test('v3: npm provider 에서 install_cmd 없음 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    providers: {
      pkg: {
        install_strategy: 'npm',
        verified_at: '2026-04-22',
      },
    },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError &&
      e.code === 'SCHEMA' &&
      /install_cmd/.test(e.message),
  );
});

test('v3: provider 값이 object 아님 → SCHEMA', () => {
  const bad = { ...VALID_V3, providers: { sp: 'not-an-object' } };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA',
  );
});

test('v3: verified_at 형식 위반 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    providers: {
      sp: {
        install_strategy: 'git-clone',
        repo: 'obra/superpowers',
        commit: SHA,
        verified_at: '2026/04/22',
      },
    },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError && e.code === 'SCHEMA' && /verified_at/.test(e.message),
  );
});

// ── invalid preset shape 거부 ─────────────────────────────────────────────────

test('v3: preset capabilities 에 허용되지 않은 이름 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    presets: { mypreset: { capabilities: ['invalid_cap'] } },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError &&
      e.code === 'SCHEMA' &&
      /invalid_cap/.test(e.message),
  );
});

test('v3: preset.capabilities 가 array 아님 → SCHEMA', () => {
  const bad = {
    ...VALID_V3,
    presets: { mypreset: { capabilities: 'planning' } },
  };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError && e.code === 'SCHEMA' && /array/.test(e.message),
  );
});

test('v3: preset 값이 object 아님 → SCHEMA', () => {
  const bad = { ...VALID_V3, presets: { mypreset: 'not-an-object' } };
  assert.throws(
    () => parseLockV3(JSON.stringify(bad)),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA',
  );
});

// ── v2 하위 호환 회귀 (parseLockV2, parseLock) ───────────────────────────────

test('v3: parseLockV3 에 v2 lock → SCHEMA (버전 불일치)', () => {
  const v2Raw = JSON.stringify({
    schema_version: 2,
    acorn_version: '0.0.0',
    tools: {
      omc: { repo: 'Yeachan-Heo/oh-my-claudecode', commit: SHA, verified_at: '2026-04-01' },
      gstack: { repo: 'garrytan/gstack', commit: SHA, verified_at: '2026-04-01' },
      ecc: { repo: 'affaan-m/everything-claude-code', commit: SHA, verified_at: '2026-04-01' },
    },
    guard: { mode: 'block', patterns: 'strict' },
  });
  assert.throws(
    () => parseLockV3(v2Raw),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA' && /불일치/.test(e.message),
  );
});

test('v3: parseLockV2 에 v3 lock → SCHEMA (버전 불일치)', () => {
  assert.throws(
    () => parseLockV2(JSON.stringify(VALID_V3)),
    (e: unknown) => e instanceof LockError && e.code === 'SCHEMA' && /불일치/.test(e.message),
  );
});

test('v3: parseLock schema_version 4 → SCHEMA 불일치', () => {
  const bad = { ...VALID_V3, schema_version: 4 };
  assert.throws(
    () => parseLock(JSON.stringify(bad)),
    (e: unknown) =>
      e instanceof LockError && e.code === 'SCHEMA' && /불일치/.test(e.message),
  );
});
