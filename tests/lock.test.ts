import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLock,
  readLock,
  getTool,
  defaultLockPath,
  LockError,
  SCHEMA_VERSION,
  TOOL_NAMES,
} from '../src/core/lock.ts';

const VALID_LOCK = {
  schema_version: 1,
  acorn_version: '0.0.0-dev',
  tools: {
    omc: {
      repo: 'Yeachan-Heo/oh-my-claudecode',
      commit: '04655ee24207f367fee785b5eb33b21234d9e0e3',
      verified_at: '2026-04-13',
    },
    gstack: {
      repo: 'garrytan/gstack',
      commit: 'c6e6a21d1a9a58e771403260ff6a134898f2dd02',
      verified_at: '2026-04-13',
    },
    ecc: {
      repo: 'affaan-m/everything-claude-code',
      commit: '125d5e619905d97b519a887d5bc7332dcc448a52',
      verified_at: '2026-04-13',
    },
  },
  guard: { mode: 'block', patterns: 'strict' },
};

test('parseLock: 정상 lock 파일 파싱', () => {
  const lock = parseLock(JSON.stringify(VALID_LOCK));
  assert.equal(lock.schema_version, SCHEMA_VERSION);
  assert.equal(lock.acorn_version, '0.0.0-dev');
  assert.equal(lock.guard.mode, 'block');
  assert.equal(lock.guard.patterns, 'strict');
  for (const name of TOOL_NAMES) {
    assert.ok(lock.tools[name].repo);
    assert.equal(lock.tools[name].commit.length, 40);
  }
});

test('parseLock: JSON 파싱 실패 → LockError(PARSE)', () => {
  assert.throws(() => parseLock('not json'), (e: unknown) => {
    return e instanceof LockError && e.code === 'PARSE';
  });
});

test('parseLock: schema_version 불일치 → LockError(SCHEMA)', () => {
  const bad = { ...VALID_LOCK, schema_version: 2 };
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('parseLock: 루트가 array → SCHEMA', () => {
  assert.throws(() => parseLock('[]'), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('parseLock: tools.omc 누락 → SCHEMA', () => {
  const bad = { ...VALID_LOCK, tools: { gstack: VALID_LOCK.tools.gstack, ecc: VALID_LOCK.tools.ecc } };
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA' && /omc.*누락/.test(e.message);
  });
});

test('parseLock: SHA가 짧으면 SCHEMA', () => {
  const bad = JSON.parse(JSON.stringify(VALID_LOCK));
  bad.tools.omc.commit = 'abc123';
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA' && /SHA1/.test(e.message);
  });
});

test('parseLock: repo 형식 위반 → SCHEMA', () => {
  const bad = JSON.parse(JSON.stringify(VALID_LOCK));
  bad.tools.omc.repo = 'no-slash';
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('parseLock: verified_at 형식 위반 → SCHEMA', () => {
  const bad = JSON.parse(JSON.stringify(VALID_LOCK));
  bad.tools.omc.verified_at = '2026/04/13';
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('parseLock: guard.mode 잘못된 값 → SCHEMA', () => {
  const bad = JSON.parse(JSON.stringify(VALID_LOCK));
  bad.guard.mode = 'panic';
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('parseLock: guard.patterns 잘못된 값 → SCHEMA', () => {
  const bad = JSON.parse(JSON.stringify(VALID_LOCK));
  bad.guard.patterns = 'paranoid';
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA';
  });
});

test('readLock: 파일 없음 → LockError(NOT_FOUND)', () => {
  assert.throws(
    () => readLock('/tmp/__acorn_nonexistent_lock__.lock'),
    (e: unknown) => e instanceof LockError && e.code === 'NOT_FOUND',
  );
});

test('readLock: 정상 파일 읽기', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-lock-'));
  const path = join(dir, 'harness.lock');
  writeFileSync(path, JSON.stringify(VALID_LOCK), 'utf8');
  try {
    const lock = readLock(path);
    assert.equal(lock.tools.gstack.repo, 'garrytan/gstack');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getTool: tool entry 조회', () => {
  const lock = parseLock(JSON.stringify(VALID_LOCK));
  const omc = getTool(lock, 'omc');
  assert.equal(omc.repo, 'Yeachan-Heo/oh-my-claudecode');
});

test('defaultLockPath: ACORN_HARNESS_ROOT 우선', () => {
  const original = process.env['ACORN_HARNESS_ROOT'];
  process.env['ACORN_HARNESS_ROOT'] = '/custom/root';
  try {
    assert.equal(defaultLockPath(), '/custom/root/harness.lock');
  } finally {
    if (original === undefined) {
      delete process.env['ACORN_HARNESS_ROOT'];
    } else {
      process.env['ACORN_HARNESS_ROOT'] = original;
    }
  }
});

test('defaultLockPath: 인자가 env보다 우선', () => {
  process.env['ACORN_HARNESS_ROOT'] = '/should-not-use';
  try {
    assert.equal(defaultLockPath('/explicit'), '/explicit/harness.lock');
  } finally {
    delete process.env['ACORN_HARNESS_ROOT'];
  }
});
