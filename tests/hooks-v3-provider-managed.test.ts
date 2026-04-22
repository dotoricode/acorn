import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { hooksCapabilityStatus } from '../src/core/hooks.ts';
import type { AnyHarnessLock } from '../src/core/lock.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHA = 'a'.repeat(40);

function v2Lock(): AnyHarnessLock {
  return {
    schema_version: 2,
    acorn_version: '0.8.0',
    tools: {
      omc:    { repo: 'test/omc',    commit: SHA, verified_at: '2026-01-01' },
      gstack: { repo: 'test/gstack', commit: SHA, verified_at: '2026-01-01' },
      ecc:    { repo: 'test/ecc',    commit: SHA, verified_at: '2026-01-01' },
    },
    optional_tools: {},
    guard: { mode: 'block', patterns: 'strict' },
  };
}

function v3LockWithHooks(providers: string[]): AnyHarnessLock {
  return {
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      hooks: { providers },
    },
    providers: {},
    guard: { mode: 'block', patterns: 'strict' },
  };
}

function v3LockNoHooksCap(): AnyHarnessLock {
  return {
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      planning: { providers: ['gsd'] },
    },
    providers: {},
    guard: { mode: 'block', patterns: 'strict' },
  };
}

function v3LockEmptyHooksCap(): AnyHarnessLock {
  return {
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      hooks: { providers: [] },
    },
    providers: {},
    guard: { mode: 'block', patterns: 'strict' },
  };
}

// ── legacy-fallback path ──────────────────────────────────────────────────────

test('hooksCapabilityStatus: v2 lock → legacy-fallback', () => {
  const s = hooksCapabilityStatus(v2Lock());
  assert.equal(s.mode, 'legacy-fallback');
  assert.deepEqual(s.providers, []);
});

test('hooksCapabilityStatus: v3 lock, no hooks capability → legacy-fallback', () => {
  const s = hooksCapabilityStatus(v3LockNoHooksCap());
  assert.equal(s.mode, 'legacy-fallback');
  assert.deepEqual(s.providers, []);
});

test('hooksCapabilityStatus: v3 lock, hooks capability with empty providers → legacy-fallback', () => {
  const s = hooksCapabilityStatus(v3LockEmptyHooksCap());
  assert.equal(s.mode, 'legacy-fallback');
  assert.deepEqual(s.providers, []);
});

// ── provider-managed path ─────────────────────────────────────────────────────

test('hooksCapabilityStatus: v3 lock + hooks + claudekit → provider-managed', () => {
  const s = hooksCapabilityStatus(v3LockWithHooks(['claudekit']));
  assert.equal(s.mode, 'provider-managed');
  assert.deepEqual(s.providers, ['claudekit']);
});

test('hooksCapabilityStatus: v3 lock + hooks + gstack + claudekit → provider-managed', () => {
  const s = hooksCapabilityStatus(v3LockWithHooks(['gstack', 'claudekit']));
  assert.equal(s.mode, 'provider-managed');
  assert.deepEqual([...s.providers], ['gstack', 'claudekit']);
});

test('hooksCapabilityStatus: provider-managed preserves all provider names', () => {
  const s = hooksCapabilityStatus(v3LockWithHooks(['gstack', 'claudekit', 'custom-hooks']));
  assert.equal(s.providers.length, 3);
  assert.ok(s.providers.includes('gstack'));
  assert.ok(s.providers.includes('claudekit'));
  assert.ok(s.providers.includes('custom-hooks'));
});

// ── type safety + shape ───────────────────────────────────────────────────────

test('hooksCapabilityStatus: result is readonly-compatible', () => {
  const s = hooksCapabilityStatus(v3LockWithHooks(['claudekit']));
  assert.ok(typeof s.mode === 'string');
  assert.ok(Array.isArray(s.providers));
});

test('hooksCapabilityStatus: mode is exactly one of the two valid values', () => {
  const legacyModes = new Set(['provider-managed', 'legacy-fallback']);
  assert.ok(legacyModes.has(hooksCapabilityStatus(v2Lock()).mode));
  assert.ok(legacyModes.has(hooksCapabilityStatus(v3LockWithHooks(['claudekit'])).mode));
});

// ── principle: acorn does not replicate claudekit hook registry ───────────────

test('hooksCapabilityStatus does not enumerate hook names (no hook registry replication)', () => {
  const s = hooksCapabilityStatus(v3LockWithHooks(['claudekit']));
  // The result carries only mode + provider names.
  // There is no "hooks" array, "hookNames", or any claudekit-specific fields.
  assert.ok(!Object.prototype.hasOwnProperty.call(s, 'hookNames'));
  assert.ok(!Object.prototype.hasOwnProperty.call(s, 'hooks'));
  assert.ok(!Object.prototype.hasOwnProperty.call(s, 'registry'));
  assert.equal(Object.keys(s).sort().join(','), 'mode,providers');
});
