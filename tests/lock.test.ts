import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLock,
  readLock,
  getTool,
  defaultLockPath,
  seedLockTemplate,
  lockTemplatePath,
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

test('parseLock: UTF-8 BOM 접두부 자동 제거 (Windows 에디터 저장 대응)', () => {
  // Windows 메모장 등이 UTF-8 로 저장 시 \uFEFF BOM 을 삽입.
  // 이 경우에도 정상 파싱되어야 한다.
  const withBom = '\uFEFF' + JSON.stringify(VALID_LOCK);
  const lock = parseLock(withBom);
  assert.equal(lock.schema_version, SCHEMA_VERSION);
  assert.equal(lock.acorn_version, '0.0.0-dev');
});

test('readLock: BOM 이 포함된 파일도 정상 읽기', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-lock-bom-'));
  const path = join(dir, 'harness.lock');
  writeFileSync(path, '\uFEFF' + JSON.stringify(VALID_LOCK), 'utf8');
  try {
    const lock = readLock(path);
    assert.equal(lock.tools.omc.repo, 'Yeachan-Heo/oh-my-claudecode');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseLock: schema_version 불일치 → LockError(SCHEMA)', () => {
  const bad = { ...VALID_LOCK, schema_version: 2 };
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return e instanceof LockError && e.code === 'SCHEMA' && /불일치/.test(e.message);
  });
});

test('parseLock: schema_version 필드 누락 → "필드 누락" 메시지 (불일치와 구분)', () => {
  // field 자체가 없을 때는 "undefined" 가 아니라 명시적으로 "누락" 을 알려야 한다.
  const { schema_version: _omit, ...bad } = VALID_LOCK;
  assert.throws(() => parseLock(JSON.stringify(bad)), (e: unknown) => {
    return (
      e instanceof LockError &&
      e.code === 'SCHEMA' &&
      /필드 누락/.test(e.message) &&
      !/불일치/.test(e.message)
    );
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
  // §15 S3: node:path.join 은 플랫폼 분리자를 사용 (Windows `\`, POSIX `/`).
  // 이전에 `/custom/root/harness.lock` 을 하드코딩해 Windows 에서 assertion fail
  // 했던 회귀 제거 — 기대값도 join() 으로 계산해 플랫폼 중립.
  const original = process.env['ACORN_HARNESS_ROOT'];
  process.env['ACORN_HARNESS_ROOT'] = '/custom/root';
  try {
    assert.equal(defaultLockPath(), join('/custom/root', 'harness.lock'));
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
    assert.equal(defaultLockPath('/explicit'), join('/explicit', 'harness.lock'));
  } finally {
    delete process.env['ACORN_HARNESS_ROOT'];
  }
});

test('lockTemplatePath: 패키지 템플릿 파일 실존 (repo + 빌드 산출물 공통)', () => {
  const p = lockTemplatePath();
  assert.ok(existsSync(p), `템플릿 파일이 없음: ${p}`);
  // 내용이 유효한 lock 스키마인지 parseLock 으로 확인 (placeholder SHA 수용)
  const raw = readFileSync(p, 'utf8');
  const parsed = parseLock(raw);
  assert.equal(parsed.schema_version, SCHEMA_VERSION);
  for (const name of TOOL_NAMES) {
    // placeholder 40-zero SHA 가 schema 통과해야 함 (format-valid)
    assert.equal(parsed.tools[name].commit, '0'.repeat(40));
  }
});

test('seedLockTemplate: 파일 없으면 템플릿 복사 (§15 C1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-seed-'));
  const lockPath = join(dir, 'harness.lock');
  try {
    assert.equal(existsSync(lockPath), false);
    const r = seedLockTemplate(lockPath);
    assert.equal(r.seeded, true);
    assert.ok(existsSync(lockPath));
    // 시드된 파일이 parseLock 을 통과해야 사용자가 edit 전에도 schema valid
    const parsed = parseLock(readFileSync(lockPath, 'utf8'));
    assert.equal(parsed.schema_version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seedLockTemplate: 기존 파일 덮어쓰지 않음 (비파괴)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-seed-'));
  const lockPath = join(dir, 'harness.lock');
  try {
    const original = '{"preserved": true}';
    writeFileSync(lockPath, original, 'utf8');
    const r = seedLockTemplate(lockPath);
    assert.equal(r.seeded, false);
    assert.equal(readFileSync(lockPath, 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seedLockTemplate: 부모 디렉토리 자동 생성 (recursive mkdir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-seed-'));
  const lockPath = join(dir, 'deep', 'nested', 'harness.lock');
  try {
    const r = seedLockTemplate(lockPath);
    assert.equal(r.seeded, true);
    assert.ok(existsSync(lockPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('§15 HIGH-2 / ADR-020 (v0.4.0): allowlist 통과 — 실 repo 3종', () => {
  // VALID_LOCK 이 이미 Yeachan-Heo/oh-my-claudecode, garrytan/gstack,
  // affaan-m/everything-claude-code 를 쓰므로 allowlist 통과 예상.
  const original = process.env['ACORN_ALLOW_ANY_REPO'];
  delete process.env['ACORN_ALLOW_ANY_REPO'];
  try {
    const lock = parseLock(JSON.stringify(VALID_LOCK));
    assert.equal(lock.tools.omc.repo, 'Yeachan-Heo/oh-my-claudecode');
    assert.equal(lock.tools.gstack.repo, 'garrytan/gstack');
    assert.equal(lock.tools.ecc.repo, 'affaan-m/everything-claude-code');
  } finally {
    if (original === undefined) delete process.env['ACORN_ALLOW_ANY_REPO'];
    else process.env['ACORN_ALLOW_ANY_REPO'] = original;
  }
});

test('§15 HIGH-2 / ADR-020: allowlist 차단 — 임의 repo 는 SCHEMA', () => {
  const original = process.env['ACORN_ALLOW_ANY_REPO'];
  delete process.env['ACORN_ALLOW_ANY_REPO'];
  const poisoned = JSON.parse(JSON.stringify(VALID_LOCK)) as typeof VALID_LOCK;
  (poisoned.tools.omc as { repo: string }).repo = 'attacker/omc';
  try {
    assert.throws(
      () => parseLock(JSON.stringify(poisoned)),
      (e: unknown) =>
        e instanceof LockError &&
        e.code === 'SCHEMA' &&
        /"attacker\/omc" 는 허용 목록에 없습니다/.test(e.message) &&
        /ACORN_ALLOW_ANY_REPO=1/.test(e.message),
    );
  } finally {
    if (original === undefined) delete process.env['ACORN_ALLOW_ANY_REPO'];
    else process.env['ACORN_ALLOW_ANY_REPO'] = original;
  }
});

test('§15 HIGH-2 / ADR-020: ACORN_ALLOW_ANY_REPO=1 escape — 임의 repo 허용', () => {
  const original = process.env['ACORN_ALLOW_ANY_REPO'];
  process.env['ACORN_ALLOW_ANY_REPO'] = '1';
  const forked = JSON.parse(JSON.stringify(VALID_LOCK)) as typeof VALID_LOCK;
  (forked.tools.gstack as { repo: string }).repo = 'myfork/gstack';
  try {
    const lock = parseLock(JSON.stringify(forked));
    assert.equal(lock.tools.gstack.repo, 'myfork/gstack');
  } finally {
    if (original === undefined) delete process.env['ACORN_ALLOW_ANY_REPO'];
    else process.env['ACORN_ALLOW_ANY_REPO'] = original;
  }
});
