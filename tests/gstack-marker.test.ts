import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gstackSetupMarkerPath,
  readGstackSetupMarker,
  writeGstackSetupMarker,
} from '../src/core/gstack-marker.ts';

const SHA_40 = 'a'.repeat(40);
const SHA_40_B = 'b'.repeat(40);

function makeRoot(): { root: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-gmark-'));
  return { root: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('writeGstackSetupMarker + readGstackSetupMarker round-trip (§15 C3)', () => {
  const { root, cleanup } = makeRoot();
  try {
    writeGstackSetupMarker(root, SHA_40);
    assert.equal(readGstackSetupMarker(root), SHA_40);
    assert.ok(existsSync(gstackSetupMarkerPath(root)));
  } finally {
    cleanup();
  }
});

test('readGstackSetupMarker: 파일 없음 → null', () => {
  const { root, cleanup } = makeRoot();
  try {
    assert.equal(readGstackSetupMarker(root), null);
  } finally {
    cleanup();
  }
});

test('readGstackSetupMarker: 손상 내용 (40자 hex 아님) → null (fail-close, 재실행 유도)', () => {
  const { root, cleanup } = makeRoot();
  try {
    writeFileSync(gstackSetupMarkerPath(root), 'not-a-sha\n', 'utf8');
    assert.equal(readGstackSetupMarker(root), null);
  } finally {
    cleanup();
  }
});

test('writeGstackSetupMarker: 덮어쓰기 (SHA 바뀌면 갱신)', () => {
  const { root, cleanup } = makeRoot();
  try {
    writeGstackSetupMarker(root, SHA_40);
    writeGstackSetupMarker(root, SHA_40_B);
    assert.equal(readGstackSetupMarker(root), SHA_40_B);
  } finally {
    cleanup();
  }
});
