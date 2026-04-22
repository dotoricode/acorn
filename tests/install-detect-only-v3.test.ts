process.env['ACORN_ALLOW_ANY_REPO'] = '1';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runGuidedInstall, renderGuidedReport } from '../src/commands/install.ts';
import { type DetectEnv } from '../src/core/provider-detect.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const V3_LOCK = JSON.stringify({
  schema_version: 3,
  acorn_version: '0.9.0',
  capabilities: {
    hooks: { providers: ['gstack'] },
    tdd: { providers: ['gstack'] },
  },
  providers: {
    gstack: { install_strategy: 'git-clone', repo: 'gstack-dev/gstack', commit: 'a'.repeat(40), verified_at: '2026-01-01' },
    claudekit: { install_strategy: 'npx', install_cmd: 'npx claudekit@latest', verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

const V2_LOCK = JSON.stringify({
  schema_version: 2,
  acorn_version: '0.6.0',
  tools: {
    omc: { repo: 'test/omc', commit: 'a'.repeat(40), verified_at: '2026-01-01' },
    gstack: { repo: 'test/gstack', commit: 'b'.repeat(40), verified_at: '2026-01-01' },
    ecc: { repo: 'test/ecc', commit: 'c'.repeat(40), verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

function makeWorkspace(lockContent: string): { harnessRoot: string; lockPath: string } {
  const harnessRoot = mkdtempSync(join(tmpdir(), 'acorn-detect-test-'));
  const lockPath = join(harnessRoot, 'harness.lock');
  writeFileSync(lockPath, lockContent);
  return { harnessRoot, lockPath };
}

function fakeDetectEnv(installed: string[] = []): DetectEnv {
  return {
    harnessRoot: '/tmp/fake',
    dirExists: (p) => installed.some((name) => p.endsWith(name)),
    commandExists: (cmd) => installed.includes(cmd),
  };
}

// ── detect-only mode ──────────────────────────────────────────────────────────

test('detect-only: mode field is detect-only', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.mode, 'detect-only');
});

test('detect-only: has detections', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.ok(report.detections.length > 0);
});

test('detect-only: no profile', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.profile, undefined);
});

test('detect-only: no recommendations', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.recommendations, undefined);
});

test('detect-only: no plans', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.plans, undefined);
});

test('detect-only: all providers detected', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  const names = report.detections.map((d) => d.provider);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('claudekit'));
});

test('detect-only: installed provider shows installed', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const env = fakeDetectEnv(['gstack']);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: env, mode: 'detect-only' });
  const gstack = report.detections.find((d) => d.provider === 'gstack');
  assert.ok(gstack !== undefined);
  assert.equal(gstack.result.state, 'installed');
});

test('detect-only: missing provider shows missing', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  const claudekit = report.detections.find((d) => d.provider === 'claudekit');
  assert.ok(claudekit !== undefined);
  assert.equal(claudekit.result.state, 'missing');
});

// ── v2 regression ─────────────────────────────────────────────────────────────

test('detect-only v2: schemaV3=false', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V2_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.schemaV3, false);
});

test('detect-only v2: detections is empty', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V2_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  assert.equal(report.detections.length, 0);
});

// ── rendering ─────────────────────────────────────────────────────────────────

test('renderGuidedReport detect-only: includes mode label', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.includes('detect-only'));
});

test('renderGuidedReport detect-only: no recommendations section', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  const rendered = renderGuidedReport(report);
  assert.ok(!rendered.includes('Recommended capabilities'));
});

test('renderGuidedReport detect-only: includes provider status', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'detect-only' });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.includes('Provider Status'));
  assert.ok(rendered.includes('gstack'));
});
