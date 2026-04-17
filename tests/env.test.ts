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

test('defaultHarnessRoot: ACORN_HARNESS_ROOT 없고 CLAUDE_CONFIG_DIR 만 있을 때', () => {
  const origHarness = process.env['ACORN_HARNESS_ROOT'];
  const origConfig = process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['ACORN_HARNESS_ROOT'];
  process.env['CLAUDE_CONFIG_DIR'] = '/custom/claude';
  try {
    assert.equal(defaultHarnessRoot(), join('/custom/claude', 'skills', 'harness'));
  } finally {
    if (origHarness !== undefined) process.env['ACORN_HARNESS_ROOT'] = origHarness;
    if (origConfig === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = origConfig;
  }
});

test('defaultHarnessRoot: env 없으면 ~/.claude/skills/harness', () => {
  const origHarness = process.env['ACORN_HARNESS_ROOT'];
  const origConfig = process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['ACORN_HARNESS_ROOT'];
  delete process.env['CLAUDE_CONFIG_DIR'];
  try {
    assert.equal(
      defaultHarnessRoot(),
      join(homedir(), '.claude', 'skills', 'harness'),
    );
  } finally {
    if (origHarness !== undefined) process.env['ACORN_HARNESS_ROOT'] = origHarness;
    if (origConfig !== undefined) process.env['CLAUDE_CONFIG_DIR'] = origConfig;
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

// §15 v0.4.1 #3 — 빈 문자열 env 는 fallback 해야 CWD 상대 경로 오염을 막는다.
test('defaultClaudeRoot: CLAUDE_CONFIG_DIR="" 이면 기본값 (homedir) 로 fallback', () => {
  const orig = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CLAUDE_CONFIG_DIR'] = '';
  try {
    // 빈 문자열이 join 에 그대로 들어가면 결과는 'skills/harness' 같은 상대 경로가 됨.
    // 정상 동작이라면 homedir() 아래를 가리켜야 한다.
    const harness = defaultHarnessRoot();
    assert.ok(
      harness.startsWith(homedir()),
      `빈 CLAUDE_CONFIG_DIR 은 homedir 로 fallback 해야 함. 실제=${harness}`,
    );
  } finally {
    if (orig === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = orig;
  }
});

test('defaultHarnessRoot: ACORN_HARNESS_ROOT="" 이면 claudeRoot 경유 기본값', () => {
  const origH = process.env['ACORN_HARNESS_ROOT'];
  const origC = process.env['CLAUDE_CONFIG_DIR'];
  process.env['ACORN_HARNESS_ROOT'] = '';
  process.env['CLAUDE_CONFIG_DIR'] = '/custom/claude';
  try {
    assert.equal(
      defaultHarnessRoot(),
      join('/custom/claude', 'skills', 'harness'),
    );
  } finally {
    if (origH === undefined) delete process.env['ACORN_HARNESS_ROOT'];
    else process.env['ACORN_HARNESS_ROOT'] = origH;
    if (origC === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = origC;
  }
});
