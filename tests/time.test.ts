import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { backupDirTs, isoTsRaw } from '../src/core/time.ts';

test('backupDirTs: ISO 형식에서 : 과 . 을 - 로 치환 (Windows 파일시스템 안전)', () => {
  const ts = backupDirTs(new Date('2026-04-18T01:33:10.541Z'));
  assert.equal(ts, '2026-04-18T01-33-10-541Z');
  assert.ok(!ts.includes(':'));
  assert.ok(!ts.includes('.'));
});

test('backupDirTs: 인자 없으면 현재 시각', () => {
  const ts = backupDirTs();
  // YYYY-MM-DDTHH-mm-ss-sssZ 패턴
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
});

test('isoTsRaw: 원본 ISO8601 유지 (tx.log 용)', () => {
  const ts = isoTsRaw(new Date('2026-04-18T01:33:10.541Z'));
  assert.equal(ts, '2026-04-18T01:33:10.541Z');
  assert.ok(ts.includes(':'));
  assert.ok(ts.includes('.'));
});

test('backupDirTs 과 isoTsRaw 는 같은 Date 로 1:1 대응', () => {
  const d = new Date('2026-06-15T12:34:56.789Z');
  assert.equal(backupDirTs(d), '2026-06-15T12-34-56-789Z');
  assert.equal(isoTsRaw(d), '2026-06-15T12:34:56.789Z');
});
