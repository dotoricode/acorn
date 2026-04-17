import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, VERSION, EXIT, usage } from '../src/index.ts';

function capture(): {
  io: { stdout: (l: string) => void; stderr: (l: string) => void };
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    },
    out,
    err,
  };
}

test('runCli: 인자 없음 → usage 출력 + OK', () => {
  const c = capture();
  const code = runCli([], c.io);
  assert.equal(code, EXIT.OK);
  assert.ok(c.out.some((l) => l.includes('acorn v')));
  assert.ok(c.out.some((l) => l.includes('install')));
});

test('runCli: --version → 버전 문자열 출력', () => {
  const c = capture();
  const code = runCli(['--version'], c.io);
  assert.equal(code, EXIT.OK);
  assert.deepEqual(c.out, [VERSION]);
});

test('runCli: -V 도 동일', () => {
  const c = capture();
  assert.equal(runCli(['-V'], c.io), EXIT.OK);
  assert.deepEqual(c.out, [VERSION]);
});

test('runCli: --help → usage', () => {
  const c = capture();
  const code = runCli(['--help'], c.io);
  assert.equal(code, EXIT.OK);
  assert.ok(c.out.join('\n').includes('사용법'));
});

test('runCli: 알 수 없는 커맨드 → EXIT.USAGE + stderr', () => {
  const c = capture();
  const code = runCli(['nope'], c.io);
  assert.equal(code, EXIT.USAGE);
  assert.ok(c.err.some((l) => l.includes('알 수 없는 커맨드')));
});

test('usage(): 3개 커맨드 모두 언급', () => {
  const u = usage();
  assert.ok(u.includes('install'));
  assert.ok(u.includes('status'));
  assert.ok(u.includes('doctor'));
  assert.ok(u.includes('--json'));
  assert.ok(u.includes('--force'));
});

test('EXIT 코드 규약', () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.FAILURE, 1);
  assert.equal(EXIT.USAGE, 64);
  assert.equal(EXIT.CONFIG, 78);
  assert.equal(EXIT.IN_PROGRESS, 75);
});

const VALID_LOCK_JSON = JSON.stringify({
  schema_version: 1,
  acorn_version: '0.1.3',
  tools: {
    omc: {
      repo: 'a/b',
      commit: 'a'.repeat(40),
      verified_at: '2026-04-17',
    },
    gstack: {
      repo: 'a/b',
      commit: 'b'.repeat(40),
      verified_at: '2026-04-17',
    },
    ecc: {
      repo: 'a/b',
      commit: 'c'.repeat(40),
      verified_at: '2026-04-17',
    },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

test('runCli: lock validate <valid path> → OK + schema 요약 출력 (§15 v0.2.0 S5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-lock-'));
  const lockPath = join(dir, 'harness.lock');
  writeFileSync(lockPath, VALID_LOCK_JSON, 'utf8');
  const c = capture();
  try {
    const code = runCli(['lock', 'validate', lockPath], c.io);
    assert.equal(code, EXIT.OK);
    assert.ok(c.out.some((l) => l.includes('harness.lock OK')));
    assert.ok(c.out.some((l) => l.includes('schema_version=1')));
    assert.ok(c.out.some((l) => l.includes('guard=block/strict')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCli: lock validate <invalid> → CONFIG exit + schema 에러', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-lock-'));
  const lockPath = join(dir, 'harness.lock');
  writeFileSync(lockPath, JSON.stringify({ schema_version: 99 }), 'utf8');
  const c = capture();
  try {
    const code = runCli(['lock', 'validate', lockPath], c.io);
    assert.equal(code, EXIT.CONFIG);
    assert.ok(c.err.some((l) => /lock\/SCHEMA/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCli: lock (서브커맨드 없음) → usage 출력', () => {
  const c = capture();
  const code = runCli(['lock'], c.io);
  // usage 는 USAGE exit — 사용자가 '뭘 하라는 건지' 명시적으로 알려줌
  assert.equal(code, EXIT.USAGE);
  assert.ok(c.out.some((l) => l.includes('lock <validate>')));
});

test('runCli: lock --help → OK + validate 설명', () => {
  const c = capture();
  const code = runCli(['lock', '--help'], c.io);
  assert.equal(code, EXIT.OK);
  assert.ok(c.out.some((l) => l.includes('validate')));
});

test('runCli: lock unknown-sub → USAGE', () => {
  const c = capture();
  const code = runCli(['lock', 'nuke'], c.io);
  assert.equal(code, EXIT.USAGE);
  assert.ok(c.err.some((l) => /알 수 없는 lock 서브커맨드/.test(l)));
});
