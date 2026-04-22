import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runPreset,
  renderPresetAction,
  PresetError,
} from '../src/commands/preset.ts';
import {
  readPreset,
  writePreset,
  resolveToPreset,
  getPresetCapabilities,
  isValidPresetName,
  PRESET_NAMES,
  LEGACY_PHASE_ALIAS,
} from '../src/core/preset.ts';

function makeHarness(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-preset-test-'));
}

// ── isValidPresetName ─────────────────────────────────────────────────────────

test('isValidPresetName: valid names', () => {
  for (const name of PRESET_NAMES) {
    assert.equal(isValidPresetName(name), true);
  }
});

test('isValidPresetName: legacy names are invalid', () => {
  assert.equal(isValidPresetName('prototype'), false);
  assert.equal(isValidPresetName('dev'), false);
  assert.equal(isValidPresetName('production'), false);
});

test('isValidPresetName: garbage is invalid', () => {
  assert.equal(isValidPresetName('foobar'), false);
  assert.equal(isValidPresetName(''), false);
  assert.equal(isValidPresetName(null), false);
});

// ── resolveToPreset ───────────────────────────────────────────────────────────

test('resolveToPreset: canonical names resolve to themselves', () => {
  assert.equal(resolveToPreset('starter'), 'starter');
  assert.equal(resolveToPreset('builder'), 'builder');
  assert.equal(resolveToPreset('frontend'), 'frontend');
  assert.equal(resolveToPreset('backend'), 'backend');
});

test('resolveToPreset: prototype → starter', () => {
  assert.equal(resolveToPreset('prototype'), 'starter');
});

test('resolveToPreset: dev → builder', () => {
  assert.equal(resolveToPreset('dev'), 'builder');
});

test('resolveToPreset: production → builder', () => {
  assert.equal(resolveToPreset('production'), 'builder');
});

test('resolveToPreset: unknown returns null', () => {
  assert.equal(resolveToPreset('foobar'), null);
  assert.equal(resolveToPreset(''), null);
});

// ── getPresetCapabilities ─────────────────────────────────────────────────────

test('starter capabilities include planning, review, hooks', () => {
  const caps = getPresetCapabilities('starter');
  assert.ok(caps.includes('planning'));
  assert.ok(caps.includes('review'));
  assert.ok(caps.includes('hooks'));
});

test('builder capabilities include spec and tdd', () => {
  const caps = getPresetCapabilities('builder');
  assert.ok(caps.includes('spec'));
  assert.ok(caps.includes('tdd'));
});

test('frontend capabilities include qa_ui, not qa_headless', () => {
  const caps = getPresetCapabilities('frontend');
  assert.ok(caps.includes('qa_ui'));
  assert.ok(!caps.includes('qa_headless'));
});

test('backend capabilities include qa_headless, not qa_ui', () => {
  const caps = getPresetCapabilities('backend');
  assert.ok(caps.includes('qa_headless'));
  assert.ok(!caps.includes('qa_ui'));
});

// ── readPreset / writePreset ──────────────────────────────────────────────────

test('readPreset: missing both files → status=missing', () => {
  const h = makeHarness();
  const r = readPreset(h);
  assert.equal(r.status, 'missing');
  assert.equal(r.value, null);
  assert.equal(r.legacy, false);
});

test('writePreset + readPreset roundtrip', () => {
  const h = makeHarness();
  writePreset('builder', h);
  const r = readPreset(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'builder');
  assert.equal(r.legacy, false);
});

test('readPreset: falls back to phase.txt legacy alias', () => {
  const h = makeHarness();
  writeFileSync(join(h, 'phase.txt'), 'dev\n', 'utf8');
  const r = readPreset(h);
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 'builder');
  assert.equal(r.legacy, true);
});

test('readPreset: preset.txt takes priority over phase.txt', () => {
  const h = makeHarness();
  writeFileSync(join(h, 'phase.txt'), 'dev\n', 'utf8');
  writePreset('frontend', h);
  const r = readPreset(h);
  assert.equal(r.value, 'frontend');
  assert.equal(r.legacy, false);
});

test('readPreset: invalid preset.txt → status=invalid', () => {
  const h = makeHarness();
  writeFileSync(join(h, 'preset.txt'), 'garbage\n', 'utf8');
  const r = readPreset(h);
  assert.equal(r.status, 'invalid');
  assert.equal(r.value, null);
});

// ── runPreset get ─────────────────────────────────────────────────────────────

test('runPreset get: no preset set → missing', () => {
  const h = makeHarness();
  const a = runPreset(undefined, { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'get');
  if (a.kind === 'get') {
    assert.equal(a.status, 'missing');
    assert.equal(a.value, null);
  }
});

test('runPreset get: after write → ok', () => {
  const h = makeHarness();
  writePreset('frontend', h);
  const a = runPreset(undefined, { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'get');
  if (a.kind === 'get') {
    assert.equal(a.value, 'frontend');
    assert.equal(a.legacy, false);
  }
});

test('runPreset get: phase.txt legacy → ok, legacy=true', () => {
  const h = makeHarness();
  writeFileSync(join(h, 'phase.txt'), 'prototype\n', 'utf8');
  const a = runPreset(undefined, { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'get');
  if (a.kind === 'get') {
    assert.equal(a.value, 'starter');
    assert.equal(a.legacy, true);
  }
});

// ── runPreset set ─────────────────────────────────────────────────────────────

test('runPreset set: canonical name succeeds', () => {
  const h = makeHarness();
  const a = runPreset('builder', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'builder');
    assert.equal(a.from, null);
    assert.equal(a.resolvedFrom, undefined);
  }
});

test('runPreset set: legacy alias resolves and marks resolvedFrom', () => {
  const h = makeHarness();
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'builder');
    assert.equal(a.resolvedFrom, 'dev');
  }
});

test('runPreset set: prototype alias resolves to starter', () => {
  const h = makeHarness();
  const a = runPreset('prototype', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'set');
  if (a.kind === 'set') {
    assert.equal(a.to, 'starter');
    assert.equal(a.resolvedFrom, 'prototype');
  }
});

test('runPreset set: persists to disk', () => {
  const h = makeHarness();
  runPreset('backend', { harnessRoot: h, yes: true });
  const r = readPreset(h);
  assert.equal(r.value, 'backend');
});

// ── noop ──────────────────────────────────────────────────────────────────────

test('runPreset: same preset → noop', () => {
  const h = makeHarness();
  writePreset('starter', h);
  const a = runPreset('starter', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
});

test('runPreset: legacy alias same resolved preset → noop', () => {
  const h = makeHarness();
  writePreset('builder', h);
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'noop');
  if (a.kind === 'noop') assert.equal(a.value, 'builder');
});

// ── invalid ───────────────────────────────────────────────────────────────────

test('runPreset: invalid value throws PresetError INVALID_VALUE', () => {
  const h = makeHarness();
  assert.throws(
    () => runPreset('foobar', { harnessRoot: h, yes: true }),
    (e: unknown) => e instanceof PresetError && e.code === 'INVALID_VALUE',
  );
});

// ── confirm_required ──────────────────────────────────────────────────────────

test('runPreset: no yes + no confirm → CONFIRM_REQUIRED', () => {
  const h = makeHarness();
  assert.throws(
    () => runPreset('builder', { harnessRoot: h }),
    (e: unknown) => e instanceof PresetError && e.code === 'CONFIRM_REQUIRED',
  );
});

test('runPreset: cancelled confirm → cancelled action', () => {
  const h = makeHarness();
  const a = runPreset('builder', { harnessRoot: h, confirm: () => false });
  assert.equal(a.kind, 'cancelled');
});

// ── list ──────────────────────────────────────────────────────────────────────

test('runPreset list subcommand', () => {
  const h = makeHarness();
  const a = runPreset('list', { harnessRoot: h, yes: true });
  assert.equal(a.kind, 'list');
});

// ── rendering ─────────────────────────────────────────────────────────────────

test('renderPresetAction get: includes capabilities', () => {
  const h = makeHarness();
  writePreset('builder', h);
  const a = runPreset(undefined, { harnessRoot: h, yes: true });
  const rendered = renderPresetAction(a);
  assert.ok(rendered.includes('builder'));
  assert.ok(rendered.includes('tdd'));
});

test('renderPresetAction set: includes from/to', () => {
  const h = makeHarness();
  const a = runPreset('frontend', { harnessRoot: h, yes: true });
  const rendered = renderPresetAction(a);
  assert.ok(rendered.includes('frontend'));
  assert.ok(rendered.includes('qa_ui'));
});

test('renderPresetAction list: includes all preset names', () => {
  const a = runPreset('list', { yes: true });
  const rendered = renderPresetAction(a);
  for (const name of PRESET_NAMES) {
    assert.ok(rendered.includes(name));
  }
  assert.ok(rendered.includes('legacy alias'));
});

test('renderPresetAction set with alias: shows resolvedFrom', () => {
  const h = makeHarness();
  const a = runPreset('dev', { harnessRoot: h, yes: true });
  const rendered = renderPresetAction(a);
  assert.ok(rendered.includes('dev'));
  assert.ok(rendered.includes('builder'));
});

// ── LEGACY_PHASE_ALIAS completeness ──────────────────────────────────────────

test('all three legacy phases have aliases', () => {
  assert.ok('prototype' in LEGACY_PHASE_ALIAS);
  assert.ok('dev' in LEGACY_PHASE_ALIAS);
  assert.ok('production' in LEGACY_PHASE_ALIAS);
});
