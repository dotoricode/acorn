import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  inspectSymlink,
  createDirSymlink,
  ensureSymlink,
  installGstackSymlink,
  inspectGstackSymlink,
  gstackSymlinkPath,
  gstackSymlinkSource,
  backupSymlinkInfo,
  SymlinkError,
} from '../src/core/symlink.ts';

function makeWorkspace(): {
  dir: string;
  source: string;
  target: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-symlink-'));
  const source = join(dir, 'source-dir');
  mkdirSync(source);
  writeFileSync(join(source, 'marker'), 'ok', 'utf8');
  const target = join(dir, 'parent', 'link');
  return {
    dir,
    source,
    target,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('inspectSymlink: 부재 → absent', () => {
  const w = makeWorkspace();
  try {
    const r = inspectSymlink(w.target, w.source);
    assert.equal(r.status, 'absent');
    assert.equal(r.currentLink, null);
  } finally {
    w.cleanup();
  }
});

test('inspectSymlink: 일반 디렉토리 → not_a_symlink', () => {
  const w = makeWorkspace();
  try {
    mkdirSync(w.target, { recursive: true });
    assert.equal(inspectSymlink(w.target, w.source).status, 'not_a_symlink');
  } finally {
    w.cleanup();
  }
});

test('inspectSymlink: 정확한 심링크 → correct', () => {
  const w = makeWorkspace();
  try {
    mkdirSync(dirname(w.target), { recursive: true });
    symlinkSync(w.source, w.target, 'dir');
    const r = inspectSymlink(w.target, w.source);
    assert.equal(r.status, 'correct');
    assert.equal(r.currentLink, w.source);
  } finally {
    w.cleanup();
  }
});

test('inspectSymlink: 다른 곳을 가리키면 → wrong_target', () => {
  const w = makeWorkspace();
  try {
    const other = join(w.dir, 'other');
    mkdirSync(other);
    mkdirSync(dirname(w.target), { recursive: true });
    symlinkSync(other, w.target, 'dir');
    assert.equal(inspectSymlink(w.target, w.source).status, 'wrong_target');
  } finally {
    w.cleanup();
  }
});

test('createDirSymlink: 부모 디렉토리 자동 생성 + 링크 작동', () => {
  const w = makeWorkspace();
  try {
    createDirSymlink(w.source, w.target);
    assert.ok(lstatSync(w.target).isSymbolicLink());
    assert.equal(readlinkSync(w.target), w.source);
    assert.ok(existsSync(join(w.target, 'marker')));
  } finally {
    w.cleanup();
  }
});

test('createDirSymlink: source 부재 → SOURCE_MISSING', () => {
  const w = makeWorkspace();
  try {
    assert.throws(
      () => createDirSymlink(join(w.dir, 'nope'), w.target),
      (e: unknown) => e instanceof SymlinkError && e.code === 'SOURCE_MISSING',
    );
  } finally {
    w.cleanup();
  }
});

test('ensureSymlink: 부재 → created', () => {
  const w = makeWorkspace();
  try {
    const r = ensureSymlink(w.source, w.target);
    assert.equal(r.action, 'created');
    assert.equal(r.previousLink, null);
    assert.ok(lstatSync(w.target).isSymbolicLink());
  } finally {
    w.cleanup();
  }
});

test('ensureSymlink: 이미 정확 → noop, 두 번째 호출도 멱등', () => {
  const w = makeWorkspace();
  try {
    ensureSymlink(w.source, w.target);
    const r2 = ensureSymlink(w.source, w.target);
    assert.equal(r2.action, 'noop');
  } finally {
    w.cleanup();
  }
});

test('ensureSymlink: 다른 target → replaced', () => {
  const w = makeWorkspace();
  try {
    const other = join(w.dir, 'other');
    mkdirSync(other);
    mkdirSync(dirname(w.target), { recursive: true });
    symlinkSync(other, w.target, 'dir');
    const r = ensureSymlink(w.source, w.target);
    assert.equal(r.action, 'replaced');
    assert.equal(resolve(r.previousLink ?? ''), resolve(other));
    assert.equal(readlinkSync(w.target), w.source);
  } finally {
    w.cleanup();
  }
});

test('ensureSymlink: wrong_target 교체 시 backupDir 제공되면 info 백업 (§15 C4)', () => {
  const w = makeWorkspace();
  try {
    const other = join(w.dir, 'other');
    mkdirSync(other);
    mkdirSync(dirname(w.target), { recursive: true });
    symlinkSync(other, w.target, 'dir');
    const backupDir = join(w.dir, 'backup', 'symlinks');
    const r = ensureSymlink(w.source, w.target, { backupDir });
    assert.equal(r.action, 'replaced');
    assert.ok(r.backup, 'replaced 결과에 backup 경로 포함되어야 함');
    assert.ok(existsSync(r.backup!));
    // info 내용 검증
    const parsed = JSON.parse(readFileSync(r.backup!, 'utf8')) as {
      target: string;
      link_target: string | null;
    };
    assert.equal(parsed.target, w.target);
    // link_target 이 이전 잘못된 symlink 의 대상
    assert.equal(resolve(parsed.link_target ?? ''), resolve(other));
  } finally {
    w.cleanup();
  }
});

test('ensureSymlink: 일반 디렉토리 존재 → NOT_SYMLINK throw, 보존', () => {
  const w = makeWorkspace();
  try {
    mkdirSync(w.target, { recursive: true });
    writeFileSync(join(w.target, 'user-file'), 'x');
    assert.throws(
      () => ensureSymlink(w.source, w.target),
      (e: unknown) => e instanceof SymlinkError && e.code === 'NOT_SYMLINK',
    );
    assert.ok(existsSync(join(w.target, 'user-file')));
  } finally {
    w.cleanup();
  }
});

test('gstackSymlinkPath / Source: 인자 전달 반영', () => {
  assert.equal(gstackSymlinkPath('/c'), join('/c', 'skills', 'gstack'));
  assert.equal(gstackSymlinkSource('/h'), join('/h', 'vendors', 'gstack'));
});

test('installGstackSymlink: end-to-end (claudeRoot+harnessRoot 격리)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-gstack-'));
  try {
    const claudeRoot = join(dir, 'claude');
    const harnessRoot = join(dir, 'harness');
    const source = join(harnessRoot, 'vendors', 'gstack');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), '# gstack');
    const r = installGstackSymlink({ claudeRoot, harnessRoot });
    assert.equal(r.action, 'created');
    const target = join(claudeRoot, 'skills', 'gstack');
    assert.ok(lstatSync(target).isSymbolicLink());
    assert.ok(existsSync(join(target, 'SKILL.md')));
    // 두 번째는 noop
    assert.equal(installGstackSymlink({ claudeRoot, harnessRoot }).action, 'noop');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inspectGstackSymlink: 부재 → absent, 정확 → correct', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-inspect-'));
  try {
    const claudeRoot = join(dir, 'claude');
    const harnessRoot = join(dir, 'harness');
    mkdirSync(join(harnessRoot, 'vendors', 'gstack'), { recursive: true });
    writeFileSync(join(harnessRoot, 'vendors', 'gstack', 'm'), 'x');

    const before = inspectGstackSymlink({ claudeRoot, harnessRoot });
    assert.equal(before.status, 'absent');

    installGstackSymlink({ claudeRoot, harnessRoot });
    const after = inspectGstackSymlink({ claudeRoot, harnessRoot });
    assert.equal(after.status, 'correct');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createDirSymlink: 기존 심링크를 rename 으로 원자 교체', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-atomic-'));
  try {
    const source1 = join(dir, 'src1');
    const source2 = join(dir, 'src2');
    mkdirSync(source1);
    mkdirSync(source2);
    writeFileSync(join(source1, 'marker'), '1');
    writeFileSync(join(source2, 'marker'), '2');

    const target = join(dir, 'parent', 'link');
    createDirSymlink(source1, target);
    assert.equal(readlinkSync(target), source1);

    // 기존 symlink 위에 직접 교체 (unlink 선행 없이)
    createDirSymlink(source2, target);
    assert.equal(readlinkSync(target), source2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backupSymlinkInfo: info JSON 파일 생성 + 필드 완비 (§15 C4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-sym-backup-'));
  const backupDir = join(dir, 'backup', '2026-04-17T14-00-00-000Z', 'symlinks');
  const target = join(dir, 'skills', 'gstack');
  const linkTarget = '/old/wrong/path';
  try {
    const infoPath = backupSymlinkInfo({
      target,
      linkTarget,
      backupDir,
      reason: 'test',
    });
    assert.ok(existsSync(infoPath));
    assert.ok(infoPath.endsWith('gstack.info'));
    const parsed = JSON.parse(readFileSync(infoPath, 'utf8')) as {
      target: string;
      link_target: string | null;
      backed_up_at: string;
      reason: string;
    };
    assert.equal(parsed.target, target);
    assert.equal(parsed.link_target, linkTarget);
    assert.equal(parsed.reason, 'test');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(parsed.backed_up_at));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backupSymlinkInfo: backupDir 자동 생성 (recursive mkdir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-sym-backup-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'symlinks');
    const infoPath = backupSymlinkInfo({
      target: join(dir, 'target'),
      linkTarget: '/x',
      backupDir: deep,
      reason: 'deep',
    });
    assert.ok(existsSync(infoPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backupSymlinkInfo: linkTarget null (symlink 이지만 readlink 실패 상상) → JSON 에 null 기록', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-sym-backup-'));
  try {
    const infoPath = backupSymlinkInfo({
      target: join(dir, 'broken'),
      linkTarget: null,
      backupDir: join(dir, 'backup'),
      reason: 'null-case',
    });
    const parsed = JSON.parse(readFileSync(infoPath, 'utf8')) as { link_target: unknown };
    assert.equal(parsed.link_target, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
