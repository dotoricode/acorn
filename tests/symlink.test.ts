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
import {
  inspectSymlink,
  createDirSymlink,
  ensureSymlink,
  installGstackSymlink,
  gstackSymlinkPath,
  gstackSymlinkSource,
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
