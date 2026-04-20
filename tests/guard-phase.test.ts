/**
 * ADR-022 (v0.7.0): guard-check.sh phase load block.
 * Verifies phase.txt → patterns mapping and env override priority chain.
 * Skipped on environments without bash.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedHookPath } from '../src/core/hooks.ts';

const SHA = 'a'.repeat(40);

function bashAvailable(): boolean {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function makeHarness(opts: { patterns?: string; phase?: string } = {}): {
  harnessRoot: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-guard-phase-'));
  writeFileSync(
    join(dir, 'harness.lock'),
    JSON.stringify({
      schema_version: 1,
      acorn_version: '0.7.0',
      tools: {
        omc: { repo: 'a/b', commit: SHA, verified_at: '2026-04-20' },
        gstack: { repo: 'a/b', commit: SHA, verified_at: '2026-04-20' },
        ecc: { repo: 'a/b', commit: SHA, verified_at: '2026-04-20' },
      },
      guard: { mode: 'block', patterns: opts.patterns ?? 'strict' },
    }),
  );
  if (opts.phase) {
    writeFileSync(join(dir, 'phase.txt'), `${opts.phase}\n`);
  }
  return { harnessRoot: dir, cleanup: () => rmSync(dir, { recursive: true }) };
}

function runHook(
  harnessRoot: string,
  command: string,
  extraEnv: Record<string, string> = {},
): { status: number; stderr: string } {
  const hookPath = packagedHookPath();
  const payload = JSON.stringify({ tool_input: { command } });
  const result = spawnSync('bash', [hookPath], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ACORN_HARNESS_ROOT: harnessRoot, ...extraEnv },
  });
  return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

test('guard-phase: phase=prototype → minimal, allows rm -rf', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  const { harnessRoot, cleanup } = makeHarness({ phase: 'prototype' });
  try {
    const r = runHook(harnessRoot, 'rm -rf /tmp/test');
    assert.equal(r.status, 0, 'prototype=minimal should allow rm -rf');
  } finally { cleanup(); }
});

test('guard-phase: phase=dev → moderate, allows push --force', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  const { harnessRoot, cleanup } = makeHarness({ phase: 'dev' });
  try {
    const r = runHook(harnessRoot, 'git push --force origin main');
    assert.equal(r.status, 0, 'dev=moderate should allow push --force');
  } finally { cleanup(); }
});

test('guard-phase: phase=dev → moderate, blocks rm -rf', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  const { harnessRoot, cleanup } = makeHarness({ phase: 'dev' });
  try {
    const r = runHook(harnessRoot, 'rm -rf /');
    assert.equal(r.status, 1, 'dev=moderate should block rm -rf');
  } finally { cleanup(); }
});

test('guard-phase: phase=production → strict, blocks push --force', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  const { harnessRoot, cleanup } = makeHarness({ phase: 'production' });
  try {
    const r = runHook(harnessRoot, 'git push --force origin main');
    assert.equal(r.status, 1, 'production=strict should block push --force');
  } finally { cleanup(); }
});

test('guard-phase: no phase.txt → falls back to lock.guard.patterns (strict)', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  const { harnessRoot, cleanup } = makeHarness({ patterns: 'strict' });
  try {
    const r = runHook(harnessRoot, 'git push --force origin main');
    assert.equal(r.status, 1, 'no phase.txt with strict lock should block push --force');
  } finally { cleanup(); }
});

test('guard-phase: ACORN_PHASE_OVERRIDE overrides phase.txt', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  // phase.txt=production (strict), but OVERRIDE=prototype (minimal)
  const { harnessRoot, cleanup } = makeHarness({ phase: 'production' });
  try {
    const r = runHook(harnessRoot, 'rm -rf /tmp/test', { ACORN_PHASE_OVERRIDE: 'prototype' });
    assert.equal(r.status, 0, 'ACORN_PHASE_OVERRIDE=prototype should allow rm -rf');
  } finally { cleanup(); }
});

test('guard-phase: ACORN_GUARD_PATTERNS overrides phase.txt', (t) => {
  if (!bashAvailable()) { t.skip('bash not available'); return; }
  // phase.txt=prototype (minimal), but GUARD_PATTERNS=strict
  const { harnessRoot, cleanup } = makeHarness({ phase: 'prototype' });
  try {
    const r = runHook(harnessRoot, 'git push --force origin main', { ACORN_GUARD_PATTERNS: 'strict' });
    assert.equal(r.status, 1, 'ACORN_GUARD_PATTERNS=strict should block push --force');
  } finally { cleanup(); }
});
