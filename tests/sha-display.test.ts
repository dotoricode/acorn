import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { shortSha, distinguishingPair } from '../src/core/sha-display.ts';

const SHA_A = 'c6e6a21d1a9a58e771403260ff6a134898f2dd02';
const SHA_A_SUFFIX_DIFF = 'c6e6a21d1a9a58e771403260ff6a134898f2dd03'; // 끝자리만 다름
const SHA_B = 'b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4'; // 첫 자리부터 다름

test('shortSha: 기본 7자', () => {
  assert.equal(shortSha(SHA_A), 'c6e6a21');
});

test('shortSha: minLen 커스텀', () => {
  assert.equal(shortSha(SHA_A, 10), 'c6e6a21d1a');
});

test('distinguishingPair: 동일 SHA → 둘 다 minLen (7자)', () => {
  const [a, b] = distinguishingPair(SHA_A, SHA_A);
  assert.equal(a, 'c6e6a21');
  assert.equal(b, 'c6e6a21');
});

test('distinguishingPair: prefix 같고 끝만 다름 → 차이 위치까지 확장 (Round 2 S4 실증)', () => {
  // SHA 가 전체 39자 동일, 마지막 1자만 02/03 로 다름
  const [a, b] = distinguishingPair(SHA_A, SHA_A_SUFFIX_DIFF);
  // 두 값이 서로 다르게 보여야 함 (착시 방지)
  assert.notEqual(a, b);
  // 각각 마지막 문자(02 vs 03)가 포함되어야 함
  assert.ok(a.endsWith('02'), `a 는 02 로 끝나야: ${a}`);
  assert.ok(b.endsWith('03'), `b 는 03 로 끝나야: ${b}`);
});

test('distinguishingPair: 첫 자리부터 다름 → minLen (7자) 만 반환', () => {
  const [a, b] = distinguishingPair(SHA_A, SHA_B);
  assert.equal(a.length, 7);
  assert.equal(b.length, 7);
  assert.notEqual(a, b);
});

test('distinguishingPair: null/undefined actual → unknown', () => {
  const [a, b] = distinguishingPair(SHA_A, null);
  assert.equal(a, 'c6e6a21');
  assert.equal(b, 'unknown');
  const [a2, b2] = distinguishingPair(SHA_A, undefined);
  assert.equal(a2, 'c6e6a21');
  assert.equal(b2, 'unknown');
});

test('distinguishingPair: 차이가 7자 이전 → minLen 7 유지', () => {
  const a = '1234567890abcdef1234567890abcdef12345678';
  const b = '12345x7890abcdef1234567890abcdef12345678';
  // 첫 차이 위치는 5. minLen 7 > 5+1=6 이므로 7자 반환
  const [ax, bx] = distinguishingPair(a, b);
  assert.equal(ax.length, 7);
  assert.equal(bx.length, 7);
  assert.notEqual(ax, bx);
});
