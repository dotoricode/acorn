import { test } from 'node:test';
import { strict as assert } from 'node:assert';
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
