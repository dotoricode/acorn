import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preAdoptMove, preAdoptPathFor } from '../src/core/adopt.ts';

test('preAdoptPathFor: <original>.pre-adopt-<ts> 형식', () => {
  const p = preAdoptPathFor('/tmp/foo', '2026-04-17T07-00-00-000Z');
  assert.equal(p, '/tmp/foo.pre-adopt-2026-04-17T07-00-00-000Z');
});

test('preAdoptMove: 파일 이동 (§15 S4-A)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-adopt-'));
  const p = join(dir, 'target');
  writeFileSync(p, 'original content', 'utf8');
  try {
    const r = preAdoptMove(p);
    assert.ok(r.preAdoptPath.startsWith(p + '.pre-adopt-'));
    assert.ok(existsSync(r.preAdoptPath));
    assert.equal(existsSync(p), false);
    // 내용 보존
    assert.equal(readFileSync(r.preAdoptPath, 'utf8'), 'original content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preAdoptMove: 디렉토리 이동', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-adopt-'));
  const sub = join(dir, 'target');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'inside.txt'), 'x', 'utf8');
  try {
    const r = preAdoptMove(sub);
    assert.ok(existsSync(r.preAdoptPath));
    assert.ok(existsSync(join(r.preAdoptPath, 'inside.txt')));
    assert.equal(existsSync(sub), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preAdoptMove: 원본 미존재 → throw', () => {
  assert.throws(
    () => preAdoptMove('/tmp/nonexistent-for-adopt-test'),
    /존재하지 않음/,
  );
});
