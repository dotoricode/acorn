import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripBom } from '../src/core/bom.ts';

test('stripBom: 선두 0xFEFF 제거', () => {
  const withBom = '\uFEFF{"a":1}';
  assert.equal(stripBom(withBom), '{"a":1}');
});

test('stripBom: BOM 없는 입력은 변경 없음', () => {
  const raw = '{"a":1}';
  assert.equal(stripBom(raw), raw);
});

test('stripBom: 빈 문자열 안전', () => {
  assert.equal(stripBom(''), '');
});

test('stripBom: 선두가 아닌 위치의 0xFEFF 는 보존 (방어적)', () => {
  const raw = '{"a":"b\uFEFFc"}';
  assert.equal(stripBom(raw), raw);
});
