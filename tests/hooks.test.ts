import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installGuardHook,
  packagedHookPath,
  HooksError,
} from '../src/core/hooks.ts';

function makeHarness(): { harnessRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-hooks-'));
  return {
    harnessRoot: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('packagedHookPath: 패키지 동봉 hook 실존 (repo + dist 공통)', () => {
  const p = packagedHookPath();
  assert.ok(existsSync(p), `hook 원본이 없음: ${p}`);
});

test('installGuardHook: 신규 설치 → created (§15 C2 ADR-017)', () => {
  const { harnessRoot, cleanup } = makeHarness();
  try {
    const r = installGuardHook(harnessRoot);
    assert.equal(r.action, 'created');
    const target = join(harnessRoot, 'hooks', 'guard-check.sh');
    assert.equal(r.target, target);
    assert.ok(existsSync(target));
    // 내용이 패키지 동봉본과 동일해야 함
    const copied = readFileSync(target);
    const source = readFileSync(packagedHookPath());
    assert.equal(copied.length, source.length);
    // Unix 에서 exec 비트가 붙어있어야 함 (Windows 는 skip)
    if (process.platform !== 'win32') {
      const mode = statSync(target).mode & 0o777;
      assert.equal(mode, 0o755, `mode 가 0o755 이어야: 실제=${mode.toString(8)}`);
    }
  } finally {
    cleanup();
  }
});

test('installGuardHook: 같은 내용 재설치 → noop (멱등성)', () => {
  const { harnessRoot, cleanup } = makeHarness();
  try {
    installGuardHook(harnessRoot);
    const r = installGuardHook(harnessRoot);
    assert.equal(r.action, 'noop');
    assert.equal(r.backup, undefined);
  } finally {
    cleanup();
  }
});

test('installGuardHook: 내용 다름 → backup 후 updated (비파괴)', () => {
  const { harnessRoot, cleanup } = makeHarness();
  try {
    const target = join(harnessRoot, 'hooks', 'guard-check.sh');
    mkdirSync(join(harnessRoot, 'hooks'), { recursive: true });
    writeFileSync(target, '# 사용자가 수정한 이전 버전\n', 'utf8');
    const userContent = '# 사용자가 수정한 이전 버전\n';

    const r = installGuardHook(harnessRoot);
    assert.equal(r.action, 'updated');
    assert.ok(r.backup, 'backup 경로가 반환되어야 함');
    // backup 파일이 이전 사용자 내용을 그대로 보존
    assert.ok(existsSync(r.backup!));
    assert.equal(readFileSync(r.backup!, 'utf8'), userContent);
    // target 은 패키지 동봉본으로 교체됨
    const newContent = readFileSync(target);
    const source = readFileSync(packagedHookPath());
    assert.equal(newContent.length, source.length);
  } finally {
    cleanup();
  }
});

test('installGuardHook: hooks 디렉토리 자동 생성', () => {
  const { harnessRoot, cleanup } = makeHarness();
  try {
    assert.equal(existsSync(join(harnessRoot, 'hooks')), false);
    installGuardHook(harnessRoot);
    assert.ok(existsSync(join(harnessRoot, 'hooks')));
  } finally {
    cleanup();
  }
});

test('HooksError: source 누락 시 SOURCE_MISSING code (정상 상황 아님 — 패키지 무결성 검사용)', () => {
  // 간접 검증: HooksError 타입과 code 가 export 되는지
  const e = new HooksError('x', 'SOURCE_MISSING');
  assert.equal(e.code, 'SOURCE_MISSING');
  assert.equal(e.name, 'HooksError');
});
