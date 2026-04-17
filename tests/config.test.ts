// §15 HIGH-2 / ADR-020 (v0.4.0): 가짜 repo 사용 — allowlist bypass.
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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runConfig,
  ConfigError,
  renderConfigAction,
} from '../src/commands/config.ts';

const VALID_LOCK = {
  schema_version: 1,
  acorn_version: '0.2.0',
  tools: {
    omc: { repo: 'a/b', commit: 'a'.repeat(40), verified_at: '2026-04-17' },
    gstack: { repo: 'a/b', commit: 'b'.repeat(40), verified_at: '2026-04-17' },
    ecc: { repo: 'a/b', commit: 'c'.repeat(40), verified_at: '2026-04-17' },
  },
  guard: { mode: 'block', patterns: 'strict' },
};

interface WS {
  dir: string;
  harnessRoot: string;
  lockPath: string;
  settingsPath: string;
  cleanup: () => void;
}

function makeWS(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-config-'));
  const harnessRoot = join(dir, 'harness');
  mkdirSync(harnessRoot, { recursive: true });
  const lockPath = join(harnessRoot, 'harness.lock');
  writeFileSync(lockPath, JSON.stringify(VALID_LOCK, null, 2), 'utf8');
  const settingsPath = join(dir, 'settings.json');
  return {
    dir,
    harnessRoot,
    lockPath,
    settingsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('runConfig: 인자 없음 → summary (§15 S3)', () => {
  const w = makeWS();
  try {
    const a = runConfig(undefined, undefined, {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
    });
    assert.equal(a.kind, 'summary');
    if (a.kind === 'summary') {
      assert.equal(a.lock.guardMode, 'block');
      assert.equal(a.lock.guardPatterns, 'strict');
    }
  } finally {
    w.cleanup();
  }
});

test('runConfig: get guard.mode (value 미지정)', () => {
  const w = makeWS();
  try {
    const a = runConfig('guard.mode', undefined, {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
    });
    assert.equal(a.kind, 'get');
    if (a.kind === 'get') assert.equal(a.value, 'block');
  } finally {
    w.cleanup();
  }
});

test('runConfig: set guard.mode warn (--yes) — lock 실제 변경 + backup 생성', () => {
  const w = makeWS();
  try {
    const a = runConfig('guard.mode', 'warn', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'set');
    if (a.kind === 'set') {
      assert.equal(a.from, 'block');
      assert.equal(a.to, 'warn');
      assert.ok(a.backup && existsSync(a.backup), 'backup 파일 존재');
    }
    // 실 lock 이 warn 으로 갱신
    const lock = JSON.parse(readFileSync(w.lockPath, 'utf8')) as typeof VALID_LOCK;
    assert.equal(lock.guard.mode, 'warn');
    // 다른 필드 보존
    assert.equal(lock.guard.patterns, 'strict');
    assert.equal(lock.tools.omc.commit, VALID_LOCK.tools.omc.commit);
  } finally {
    w.cleanup();
  }
});

test('runConfig: set guard.mode bogus → SCHEMA 에러 + lock 무변경', () => {
  const w = makeWS();
  try {
    const original = readFileSync(w.lockPath, 'utf8');
    assert.throws(
      () =>
        runConfig('guard.mode', 'bogus', {
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          yes: true,
        }),
      (e: unknown) => e instanceof ConfigError && e.code === 'SCHEMA',
    );
    // 파일 내용 불변
    assert.equal(readFileSync(w.lockPath, 'utf8'), original);
  } finally {
    w.cleanup();
  }
});

test('runConfig: set guard.mode block (동일 값) → noop', () => {
  const w = makeWS();
  try {
    const before = readFileSync(w.lockPath, 'utf8');
    const a = runConfig('guard.mode', 'block', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'noop');
    // 파일 timestamp/내용 보존
    assert.equal(readFileSync(w.lockPath, 'utf8'), before);
  } finally {
    w.cleanup();
  }
});

test('runConfig: set guard.patterns minimal --yes', () => {
  const w = makeWS();
  try {
    const a = runConfig('guard.patterns', 'minimal', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'set');
    const lock = JSON.parse(readFileSync(w.lockPath, 'utf8')) as typeof VALID_LOCK;
    assert.equal(lock.guard.patterns, 'minimal');
  } finally {
    w.cleanup();
  }
});

test('runConfig: set guard.mode 확인 거절 → cancelled + lock 무변경', () => {
  const w = makeWS();
  try {
    const before = readFileSync(w.lockPath, 'utf8');
    const a = runConfig('guard.mode', 'warn', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      confirm: () => false, // 사용자가 n 선택
    });
    assert.equal(a.kind, 'cancelled');
    assert.equal(readFileSync(w.lockPath, 'utf8'), before);
  } finally {
    w.cleanup();
  }
});

test('runConfig: yes=false + confirm 미지정 → CONFIRM_REQUIRED (non-TTY)', () => {
  const w = makeWS();
  try {
    assert.throws(
      () =>
        runConfig('guard.mode', 'warn', {
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          // confirm 미지정 + yes=false
        }),
      (e: unknown) => e instanceof ConfigError && e.code === 'CONFIRM_REQUIRED',
    );
  } finally {
    w.cleanup();
  }
});

test('runConfig: env.reset — env 3키 제거 + 다른 키 보존', () => {
  const w = makeWS();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        theme: 'dark',
        model: 'sonnet',
        env: {
          CLAUDE_PLUGIN_ROOT: '/some/path',
          OMC_PLUGIN_ROOT: '/some/omc',
          ECC_ROOT: '/some/ecc',
          OTHER_KEY: 'keep-me',
        },
      }),
    );
    const a = runConfig('env.reset', undefined, {
      lockPath: w.lockPath,
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'reset');
    if (a.kind === 'reset') {
      assert.deepEqual(
        [...a.removedKeys].sort(),
        ['CLAUDE_PLUGIN_ROOT', 'ECC_ROOT', 'OMC_PLUGIN_ROOT'],
      );
      assert.ok(a.backup && existsSync(a.backup));
    }
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as {
      theme: string;
      model: string;
      env: Record<string, string>;
    };
    assert.equal(written.theme, 'dark');
    assert.equal(written.model, 'sonnet');
    assert.equal(written.env['OTHER_KEY'], 'keep-me');
    assert.equal(written.env['CLAUDE_PLUGIN_ROOT'], undefined);
    assert.equal(written.env['OMC_PLUGIN_ROOT'], undefined);
    assert.equal(written.env['ECC_ROOT'], undefined);
  } finally {
    w.cleanup();
  }
});

test('runConfig: env.reset — settings 파일 없으면 removedKeys 빈 배열', () => {
  const w = makeWS();
  try {
    const a = runConfig('env.reset', undefined, {
      lockPath: w.lockPath,
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'reset');
    if (a.kind === 'reset') {
      assert.equal(a.removedKeys.length, 0);
    }
  } finally {
    w.cleanup();
  }
});

test('runConfig: env.reset — env 키 없으면 removedKeys 빈 배열', () => {
  const w = makeWS();
  try {
    writeFileSync(w.settingsPath, JSON.stringify({ theme: 'dark' }));
    const a = runConfig('env.reset', undefined, {
      lockPath: w.lockPath,
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'reset');
    if (a.kind === 'reset') assert.equal(a.removedKeys.length, 0);
  } finally {
    w.cleanup();
  }
});

test('runConfig: 알 수 없는 key → UNKNOWN_KEY 에러', () => {
  const w = makeWS();
  try {
    assert.throws(
      () =>
        runConfig('nonexistent.key', 'x', {
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          yes: true,
        }),
      (e: unknown) => e instanceof ConfigError && e.code === 'UNKNOWN_KEY',
    );
  } finally {
    w.cleanup();
  }
});

test('§15 B2: set guard.mode → tx.log 에 phase=config-guard.mode + commit 기록', () => {
  const w = makeWS();
  try {
    runConfig('guard.mode', 'warn', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    const txPath = join(w.harnessRoot, 'tx.log');
    assert.ok(existsSync(txPath), 'tx.log 생성됨');
    const lines = readFileSync(txPath, 'utf8').trim().split('\n');
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(events[0]?.['status'], 'begin');
    assert.equal(events[1]?.['status'], 'phase');
    assert.equal(events[1]?.['phase'], 'config-guard.mode');
    assert.equal(events[events.length - 1]?.['status'], 'commit');
  } finally {
    w.cleanup();
  }
});

test('§15 B2: set guard.patterns → phase=config-guard.patterns', () => {
  const w = makeWS();
  try {
    runConfig('guard.patterns', 'moderate', {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    const lines = readFileSync(join(w.harnessRoot, 'tx.log'), 'utf8')
      .trim()
      .split('\n');
    const phases = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e['status'] === 'phase')
      .map((e) => e['phase']);
    assert.deepEqual(phases, ['config-guard.patterns']);
  } finally {
    w.cleanup();
  }
});

test('§15 B2: env.reset → phase=config-env.reset + commit', () => {
  const w = makeWS();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({ env: { CLAUDE_PLUGIN_ROOT: '/x' } }, null, 2),
      'utf8',
    );
    runConfig('env.reset', undefined, {
      lockPath: w.lockPath,
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    const lines = readFileSync(join(w.harnessRoot, 'tx.log'), 'utf8')
      .trim()
      .split('\n');
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.ok(
      events.some(
        (e) => e['status'] === 'phase' && e['phase'] === 'config-env.reset',
      ),
    );
    assert.equal(events[events.length - 1]?.['status'], 'commit');
  } finally {
    w.cleanup();
  }
});

test('§15 B2: SCHEMA 실패 → tx.log 에 abort 기록', () => {
  const w = makeWS();
  try {
    assert.throws(() =>
      runConfig('guard.mode', 'bogus', {
        lockPath: w.lockPath,
        harnessRoot: w.harnessRoot,
        yes: true,
      }),
    );
    const lines = readFileSync(join(w.harnessRoot, 'tx.log'), 'utf8')
      .trim()
      .split('\n');
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(events[events.length - 1]?.['status'], 'abort');
  } finally {
    w.cleanup();
  }
});

test('§15 B2: read-only 경로 (summary, get) 는 tx.log 건드리지 않음', () => {
  const w = makeWS();
  try {
    runConfig(undefined, undefined, {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
    });
    runConfig('guard.mode', undefined, {
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
    });
    assert.equal(existsSync(join(w.harnessRoot, 'tx.log')), false);
  } finally {
    w.cleanup();
  }
});

test('renderConfigAction: 사람 친화 출력 포맷', () => {
  assert.ok(renderConfigAction({ kind: 'get', key: 'guard.mode', value: 'block' }).includes('block'));
  assert.ok(
    renderConfigAction({
      kind: 'set',
      key: 'guard.mode',
      from: 'block',
      to: 'warn',
      backup: '/tmp/bak',
    }).includes('→'),
  );
  assert.ok(
    renderConfigAction({ kind: 'noop', key: 'guard.mode', value: 'block' }).includes(
      '변경 없음',
    ),
  );
  assert.ok(
    renderConfigAction({ kind: 'cancelled', key: 'guard.mode' }).includes('취소됨'),
  );
});
