import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPhase, writePhase } from '../src/core/phase.ts';
import { readPreset, writePreset, resolveToPreset } from '../src/core/preset.ts';
import { runPreset, PresetError } from '../src/commands/preset.ts';

function makeHarness(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-phase-alias-test-'));
}

// ── phase.txt 기존 동작 유지 검증 ────────────────────────────────────────────

test('writePhase + readPhase: phase.txt 기존 동작 유지', () => {
  const h = makeHarness();
  writePhase('prototype', h);
  const r = readPhase(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'prototype');
});

test('writePhase: dev phase 유지', () => {
  const h = makeHarness();
  writePhase('dev', h);
  const r = readPhase(h);
  assert.equal(r.value, 'dev');
});

test('writePhase: production phase 유지', () => {
  const h = makeHarness();
  writePhase('production', h);
  const r = readPhase(h);
  assert.equal(r.value, 'production');
});

// ── legacy alias: phase.txt → preset 해석 ────────────────────────────────────

test('prototype phase.txt → readPreset resolves to starter', () => {
  const h = makeHarness();
  writePhase('prototype', h);
  const r = readPreset(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'starter');
  assert.equal(r.legacy, true);
});

test('dev phase.txt → readPreset resolves to builder', () => {
  const h = makeHarness();
  writePhase('dev', h);
  const r = readPreset(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'builder');
  assert.equal(r.legacy, true);
});

test('production phase.txt → readPreset resolves to builder', () => {
  const h = makeHarness();
  writePhase('production', h);
  const r = readPreset(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'builder');
  assert.equal(r.legacy, true);
});

// ── preset.txt 우선순위: phase.txt 보다 항상 우선 ─────────────────────────────

test('preset.txt takes precedence over phase.txt', () => {
  const h = makeHarness();
  writePhase('prototype', h);
  writePreset('backend', h);
  const r = readPreset(h);
  assert.equal(r.value, 'backend');
  assert.equal(r.legacy, false);
});

test('phase.txt=production, preset.txt=frontend → frontend 반환', () => {
  const h = makeHarness();
  writePhase('production', h);
  writePreset('frontend', h);
  const r = readPreset(h);
  assert.equal(r.value, 'frontend');
  assert.equal(r.legacy, false);
});

// ── resolveToPreset: legacy alias 해석 ────────────────────────────────────────

test('resolveToPreset: prototype → starter', () => {
  assert.equal(resolveToPreset('prototype'), 'starter');
});

test('resolveToPreset: dev → builder', () => {
  assert.equal(resolveToPreset('dev'), 'builder');
});

test('resolveToPreset: production → builder', () => {
  assert.equal(resolveToPreset('production'), 'builder');
});

test('resolveToPreset: canonical names resolve to themselves', () => {
  assert.equal(resolveToPreset('starter'), 'starter');
  assert.equal(resolveToPreset('builder'), 'builder');
  assert.equal(resolveToPreset('frontend'), 'frontend');
  assert.equal(resolveToPreset('backend'), 'backend');
});

test('resolveToPreset: unknown → null', () => {
  assert.equal(resolveToPreset('foobar'), null);
  assert.equal(resolveToPreset(''), null);
});

// ── preset 설정 성공 ───────────────────────────────────────────────────────────

test('runPreset set: starter 설정 성공', () => {
  const h = makeHarness();
  const a = runPreset('starter', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'starter');
    assert.equal(a.from, null);
  }
});

test('runPreset set: builder 설정 후 readPreset 확인', () => {
  const h = makeHarness();
  runPreset('builder', { harnessRoot: h, yes: true });
  const r = readPreset(h);
  assert.equal(r.value, 'builder');
  assert.equal(r.legacy, false);
});

test('runPreset set: legacy alias prototype → starter 설정', () => {
  const h = makeHarness();
  const a = runPreset('prototype', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'starter');
    assert.equal(a.resolvedFrom, 'prototype');
  }
  const r = readPreset(h);
  assert.equal(r.value, 'starter');
  assert.equal(r.legacy, false);
});

test('runPreset set: legacy alias dev → builder 설정', () => {
  const h = makeHarness();
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'builder');
    assert.equal(a.resolvedFrom, 'dev');
  }
});

test('runPreset set: legacy alias production → builder 설정', () => {
  const h = makeHarness();
  const a = runPreset('production', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'builder');
    assert.equal(a.resolvedFrom, 'production');
  }
});

// ── noop 동작 ─────────────────────────────────────────────────────────────────

test('runPreset noop: 동일 preset 재설정', () => {
  const h = makeHarness();
  writePreset('frontend', h);
  const a = runPreset('frontend', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
  if (a.kind === 'noop') assert.equal(a.value, 'frontend');
});

test('runPreset noop: legacy alias → 이미 해당 preset', () => {
  const h = makeHarness();
  writePreset('builder', h);
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
  if (a.kind === 'noop') assert.equal(a.value, 'builder');
});

test('runPreset noop: prototype alias → 이미 starter', () => {
  const h = makeHarness();
  writePreset('starter', h);
  const a = runPreset('prototype', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
});

// ── legacy phase alias 가 readPreset noop 에도 영향 ──────────────────────────

test('phase.txt=dev, runPreset dev → noop (해석 후 동일)', () => {
  const h = makeHarness();
  writePhase('dev', h);
  // preset.txt 없음 → phase.txt 에서 builder 로 읽힘
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  // phase.txt 에서 읽은 builder 와 dev→builder 해석이 같으므로 noop
  assert.equal(a.kind, 'noop');
  if (a.kind === 'noop') assert.equal(a.value, 'builder');
});

test('phase.txt=prototype, runPreset prototype → noop', () => {
  const h = makeHarness();
  writePhase('prototype', h);
  const a = runPreset('prototype', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
});

// ── invalid preset 거부 ────────────────────────────────────────────────────────

test('runPreset: invalid value → PresetError INVALID_VALUE', () => {
  const h = makeHarness();
  assert.throws(
    () => runPreset('garbage', { harnessRoot: h, yes: true }),
    (e: unknown) => e instanceof PresetError && e.code === 'INVALID_VALUE',
  );
});

test('runPreset: empty string → PresetError INVALID_VALUE', () => {
  const h = makeHarness();
  assert.throws(
    () => runPreset('', { harnessRoot: h, yes: true }),
    (e: unknown) => e instanceof PresetError && e.code === 'INVALID_VALUE',
  );
});

test('runPreset: 알 수 없는 phase 이름 → PresetError INVALID_VALUE', () => {
  const h = makeHarness();
  assert.throws(
    () => runPreset('alpha', { harnessRoot: h, yes: true }),
    (e: unknown) => e instanceof PresetError && e.code === 'INVALID_VALUE',
  );
});

// ── phase.txt 에 invalid preset 이름이 있는 경우 ─────────────────────────────

test('phase.txt 에 invalid 값 → readPreset status=missing (alias 없음)', () => {
  const h = makeHarness();
  writeFileSync(join(h, 'phase.txt'), 'unknown-phase\n', 'utf8');
  const r = readPreset(h);
  assert.equal(r.status, 'missing');
  assert.equal(r.value, null);
});

// ── 전환 시나리오 ──────────────────────────────────────────────────────────────

test('prototype → dev alias 전환: starter → builder', () => {
  const h = makeHarness();
  runPreset('prototype', { harnessRoot: h, yes: true });
  assert.equal(readPreset(h).value, 'starter');

  runPreset('dev', { harnessRoot: h, yes: true });
  assert.equal(readPreset(h).value, 'builder');
});

test('backend → frontend 전환', () => {
  const h = makeHarness();
  runPreset('backend', { harnessRoot: h, yes: true });
  assert.equal(readPreset(h).value, 'backend');

  runPreset('frontend', { harnessRoot: h, yes: true });
  assert.equal(readPreset(h).value, 'frontend');
});
