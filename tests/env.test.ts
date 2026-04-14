import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  computeEnv,
  defaultHarnessRoot,
  vendorsRoot,
  diffEnv,
  isEnvFullyMatched,
  ENV_KEYS,
} from '../src/core/env.ts';

test('defaultHarnessRoot: ACORN_HARNESS_ROOT 우선', () => {
  const original = process.env['ACORN_HARNESS_ROOT'];
  process.env['ACORN_HARNESS_ROOT'] = '/custom/harness';
  try {
    assert.equal(defaultHarnessRoot(), '/custom/harness');
  } finally {
    if (original === undefined) delete process.env['ACORN_HARNESS_ROOT'];
    else process.env['ACORN_HARNESS_ROOT'] = original;
  }
});

test('defaultHarnessRoot: env 없으면 ~/.claude/skills/harness', () => {
  const original = process.env['ACORN_HARNESS_ROOT'];
  delete process.env['ACORN_HARNESS_ROOT'];
  try {
    assert.equal(
      defaultHarnessRoot(),
      join(homedir(), '.claude', 'skills', 'harness'),
    );
  } finally {
    if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
  }
});

test('vendorsRoot: harness 아래 vendors', () => {
  assert.equal(vendorsRoot('/x/harness'), join('/x/harness', 'vendors'));
});

test('computeEnv: 3키 모두 vendors 하위 경로', () => {
  const env = computeEnv('/h');
  assert.equal(env.CLAUDE_PLUGIN_ROOT, join('/h', 'vendors'));
  assert.equal(env.OMC_PLUGIN_ROOT, join('/h', 'vendors', 'omc'));
  assert.equal(env.ECC_ROOT, join('/h', 'vendors', 'ecc'));
});

test('computeEnv: 모든 ENV_KEYS 항목 반환', () => {
  const env = computeEnv('/h');
  for (const k of ENV_KEYS) {
    assert.ok(typeof env[k] === 'string' && env[k].length > 0);
  }
});

test('diffEnv: 완전 일치 → 모두 match', () => {
  const expected = computeEnv('/h');
  const diff = diffEnv(expected, expected);
  assert.equal(diff.length, 3);
  for (const d of diff) assert.equal(d.status, 'match');
  assert.ok(isEnvFullyMatched(diff));
});

test('diffEnv: actual 키 누락 → missing', () => {
  const expected = computeEnv('/h');
  const diff = diffEnv(expected, {});
  for (const d of diff) {
    assert.equal(d.status, 'missing');
    assert.equal(d.actual, undefined);
  }
  assert.ok(!isEnvFullyMatched(diff));
});

test('diffEnv: actual 빈 문자열 → missing', () => {
  const expected = computeEnv('/h');
  const diff = diffEnv(expected, {
    CLAUDE_PLUGIN_ROOT: '',
    OMC_PLUGIN_ROOT: '',
    ECC_ROOT: '',
  });
  for (const d of diff) assert.equal(d.status, 'missing');
});

test('diffEnv: actual 다른 값 → mismatch', () => {
  const expected = computeEnv('/h');
  const diff = diffEnv(expected, {
    CLAUDE_PLUGIN_ROOT: '/wrong',
    OMC_PLUGIN_ROOT: expected.OMC_PLUGIN_ROOT,
    ECC_ROOT: expected.ECC_ROOT,
  });
  const byKey = Object.fromEntries(diff.map((d) => [d.key, d]));
  assert.equal(byKey['CLAUDE_PLUGIN_ROOT']!.status, 'mismatch');
  assert.equal(byKey['OMC_PLUGIN_ROOT']!.status, 'match');
  assert.equal(byKey['ECC_ROOT']!.status, 'match');
  assert.ok(!isEnvFullyMatched(diff));
});

test('diffEnv: process.env 기본값 사용 가능', () => {
  const expected = computeEnv('/h');
  const diff = diffEnv(expected);
  assert.equal(diff.length, 3);
});
